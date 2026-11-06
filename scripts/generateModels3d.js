'use strict';

/**
 * Genera con IA el modelo 3D (GLB) de los productos que aún no tienen uno y lo publica en su ficha
 * y en la tienda virtual ("Ver en 3D").
 *
 *   node scripts/generateModels3d.js                    → solo muestra qué productos faltan
 *   node scripts/generateModels3d.js --apply            → genera y publica los que alcance el cupo del día
 *   node scripts/generateModels3d.js --apply --product prod_xxx   → solo ese producto
 *   node scripts/generateModels3d.js --apply --limit 3  → como mucho 3 productos
 *
 * Cómo funciona: toma la foto sin fondo de la prenda (la de la tienda virtual), la envía a TRELLIS 2
 * (Microsoft, en Hugging Face, con HF_TOKEN del .env), comprime el GLB para que cargue rápido en
 * celular, lo sube a S3 y lo guarda en el producto. Los perfumes se saltan.
 *
 * Hugging Face da un cupo de GPU por día: cuando se acaba, el script se detiene sin error y la
 * siguiente ejecución sigue con los que faltan. Es seguro repetirlo.
 */

require('dotenv').config();
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { PutObjectCommand } = require('@aws-sdk/client-s3');
const { getS3Client } = require('../lambdas/shared/s3Service');
const productRepository = require('../lambdas/shared/productRepository');
const { MODEL_TYPE, modelUploadKey, validateProductModel } = require('../lambdas/shared/productModel3d');

const SPACE = 'microsoft/TRELLIS.2';
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const onlyProduct = option('--product');
const limit = Number(option('--limit') || Infinity);

const bucket = () => process.env.AWS_S3_BUCKET || 'gnfls';
const region = () => process.env.AWS_S3_REGION || 'us-east-2';
const publicUrl = (key) => `https://${bucket()}.s3.${region()}.amazonaws.com/${key}`;

/** Foto para la IA: el recorte sin fondo de la primera foto que tenga uno; si no hay, la primera foto. */
function sourcePhoto(product) {
  const photos = product.virtualStoreImages?.length ? product.virtualStoreImages : product.images || [];
  return photos.map((url) => product.cutouts?.[url]).find(Boolean) || photos[0] || null;
}

const isQuotaError = (err) => /quota/i.test(`${err?.title || ''} ${err?.message || ''}`);

async function generate(client, handleFile, png) {
  await client.predict('/start_session', []);
  const pre = await client.predict('/preprocess_image', { input: handleFile(new Blob([png], { type: 'image/png' })) });
  await client.predict('/image_to_3d', { image: pre.data[0], seed: 0, resolution: '1024' });
  const glb = await client.predict('/extract_glb', [null, 120000, 1024]);
  const file = glb.data.find((f) => f?.url?.includes('.glb')) ?? glb.data[0];
  if (!file?.url) throw new Error('La IA no devolvió un GLB');
  return Buffer.from(await (await fetch(file.url)).arrayBuffer());
}

/** Comprime el GLB (geometría con meshopt, texturas WebP de 1024 px): ~7 MB → ~2 MB. */
function optimize(raw) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'envi3d-'));
  const input = path.join(dir, 'in.glb');
  const output = path.join(dir, 'out.glb');
  fs.writeFileSync(input, raw);
  const bin = path.join(__dirname, '..', 'node_modules', '.bin', 'gltf-transform');
  execFileSync(bin, ['optimize', input, output, '--compress', 'meshopt', '--texture-compress', 'webp', '--texture-size', '1024', '--simplify-ratio', '0.5'], { stdio: 'ignore' });
  const result = fs.readFileSync(output);
  fs.rmSync(dir, { recursive: true, force: true });
  return result;
}

(async () => {
  const products = (await productRepository.getAll())
    .filter((p) => (onlyProduct ? p.productId === onlyProduct : !p.model3d && !p.perfume))
    .map((p) => ({ product: p, photo: sourcePhoto(p) }));
  const ready = products.filter((x) => x.photo);
  const noPhoto = products.filter((x) => !x.photo);
  console.log(`Productos sin modelo 3D: ${products.length} · con foto para generarlo: ${ready.length}`);
  noPhoto.forEach(({ product }) => console.log(`  · sin fotos, se salta: ${product.name}`));
  if (!apply) {
    ready.forEach(({ product }) => console.log(`  · ${product.name}`));
    console.log('\nNo se generó nada. Ejecuta con --apply para generarlos y publicarlos.');
    return;
  }
  if (!process.env.HF_TOKEN) throw new Error('Falta HF_TOKEN en el .env');

  const { Client, handle_file: handleFile } = await import('@gradio/client');
  const sharp = require('sharp');
  const s3 = getS3Client();
  let done = 0;
  for (const { product, photo } of ready.slice(0, limit)) {
    const t0 = Date.now();
    try {
      const png = await sharp(Buffer.from(await (await fetch(photo)).arrayBuffer())).png().toBuffer();
      const client = await Client.connect(SPACE, { hf_token: process.env.HF_TOKEN });
      const glb = optimize(await generate(client, handleFile, png));
      const key = modelUploadKey(glb.length);
      await s3.send(new PutObjectCommand({ Bucket: bucket(), Key: key, Body: glb, ContentType: MODEL_TYPE, CacheControl: 'public, max-age=31536000, immutable' }));
      await productRepository.update(product.productId, { model3d: validateProductModel(publicUrl(key)) });
      done++;
      console.log(`✓ ${product.name}: ${Math.round(glb.length / 1024)} KB en ${Math.round((Date.now() - t0) / 1000)} s`);
    } catch (err) {
      if (isQuotaError(err)) {
        console.log(`\nSe acabó el cupo de IA de hoy en Hugging Face. ${err.message || ''}`);
        break;
      }
      console.log(`✗ ${product.name}: ${err.message || err.title || err}`);
    }
  }
  console.log(`\nListo: ${done} modelo(s) 3D publicados. Faltan ${ready.length - done}.`);
  process.exit(0);
})().catch((err) => {
  console.error('Error:', err.message || err);
  process.exit(1);
});
