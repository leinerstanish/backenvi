'use strict';

const { GetObjectCommand, PutObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
const { getS3Client } = require('./s3Service');
const { HttpError } = require('./catalogRules');

/**
 * Fotos de un producto por lugar y sus miniaturas.
 *
 * - images: fotos de la tienda (landing, boutique, ficha, carrito). Es la lista de siempre.
 * - lookbookImages / virtualStoreImages: fotos propias del lookbook y de la tienda virtual.
 *   Vacías significa "usar las de la tienda" (lo resuelve el frontend).
 * - thumbnails: { urlOriginal: urlMiniatura } con versiones WebP livianas para tarjetas y listas.
 */

const CHANNEL_FIELDS = ['lookbookImages', 'virtualStoreImages'];
const MAX_CHANNEL_IMAGES = 20;
const THUMB_WIDTH = 640;
const THUMB_QUALITY = 78;
const THUMB_FOLDER = 'products/thumbs';
const CONCURRENCY = 3;

const bucket = () => process.env.AWS_S3_BUCKET || 'gnfls';
const region = () => process.env.AWS_S3_REGION || 'us-east-2';
const bucketUrl = () => `https://${bucket()}.s3.${region()}.amazonaws.com/`;
const encodeKey = (key) => key.split('/').map(encodeURIComponent).join('/');

/**
 * Valida las listas de fotos por lugar que trae la petición. Un campo ausente (undefined)
 * significa "no tocar"; los clientes que no conocen estos campos siguen funcionando igual.
 */
function validateChannelImages(input) {
  const out = {};
  for (const field of CHANNEL_FIELDS) {
    const value = input[field];
    if (value === undefined) continue;
    if (value === null) {
      out[field] = [];
      continue;
    }
    if (!Array.isArray(value) || value.some((url) => typeof url !== 'string')) {
      throw new HttpError(400, `${field} debe ser una lista de URLs`);
    }
    if (value.length > MAX_CHANNEL_IMAGES) {
      throw new HttpError(400, `${field} admite máximo ${MAX_CHANNEL_IMAGES} fotos`);
    }
    out[field] = value;
  }
  return out;
}

/** Llave en S3 de una URL de nuestro bucket; null si la foto está en otro sitio. */
function keyOf(url) {
  if (typeof url !== 'string' || !url.startsWith(bucketUrl())) return null;
  try {
    return decodeURIComponent(url.slice(bucketUrl().length).split('?')[0]);
  } catch {
    return null;
  }
}

const thumbKeyOf = (key) => `${THUMB_FOLDER}/${key.replace(/^products\//, '').replace(/\.[^./]+$/, '')}.w${THUMB_WIDTH}.webp`;

let sharpModule;
function loadSharp() {
  // Se carga solo cuando hace falta: el resto de lambdas no paga el costo de la librería.
  if (sharpModule === undefined) {
    try {
      sharpModule = require('sharp');
    } catch (err) {
      console.error('[productImages] sharp no está disponible; no se crean miniaturas:', err.message);
      sharpModule = null;
    }
  }
  return sharpModule;
}

async function exists(client, key) {
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket(), Key: key }));
    return true;
  } catch (err) {
    if (err.$metadata?.httpStatusCode === 404 || err.name === 'NotFound') return false;
    throw err;
  }
}

/** Crea (si no existe) la miniatura WebP de una foto de nuestro bucket y devuelve su URL. */
async function createThumbnail(url, client = getS3Client()) {
  const key = keyOf(url);
  if (!key || key.startsWith(`${THUMB_FOLDER}/`)) return null;
  const sharp = loadSharp();
  if (!sharp) return null;

  const thumbKey = thumbKeyOf(key);
  if (!(await exists(client, thumbKey))) {
    const original = await client.send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
    const input = Buffer.from(await original.Body.transformToByteArray());
    const output = await sharp(input)
      .rotate() // respeta la orientación de la foto del celular
      .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
      .webp({ quality: THUMB_QUALITY })
      .toBuffer();
    await client.send(new PutObjectCommand({
      Bucket: bucket(),
      Key: thumbKey,
      Body: output,
      ContentType: 'image/webp',
      CacheControl: 'public, max-age=31536000, immutable',
    }));
  }
  return bucketUrl() + encodeKey(thumbKey);
}

/**
 * Miniaturas para todas las fotos del producto. Reutiliza las que ya existen en `previous` y
 * solo procesa las nuevas. Si una foto falla, se omite: guardar el producto nunca se cae por esto.
 */
async function buildThumbnails(urls, previous = {}) {
  const unique = [...new Set(urls.filter(Boolean))];
  const result = {};
  const pending = [];
  for (const url of unique) {
    if (previous && previous[url]) result[url] = previous[url];
    else if (keyOf(url)) pending.push(url);
  }
  if (pending.length === 0) return result;

  const client = getS3Client();
  for (let i = 0; i < pending.length; i += CONCURRENCY) {
    await Promise.all(
      pending.slice(i, i + CONCURRENCY).map(async (url) => {
        try {
          const thumb = await createThumbnail(url, client);
          if (thumb) result[url] = thumb;
        } catch (err) {
          console.error('[productImages] No se pudo crear la miniatura de', url, err.message);
        }
      })
    );
  }
  return result;
}

// ─── Recorte de fondo para la tienda virtual ─────────────────────────────

const CUTOUT_FOLDER = 'products/cutouts';
const CUTOUT_WORK = 900; // tamaño de trabajo: suficiente para el borde y rápido en la lambda
const CUTOUT_WIDTH = 640;
const BG_NEAR = 14; // distancia de color: por debajo, es fondo (transparente)
const BG_FAR = 34; // por encima, es prenda; entre ambos, borde suave
const SHADOW_TINT = 14; // las sombras son grises: casi sin diferencia entre rojo, verde y azul
const SHADOW_LIGHT = 28; // sombra muy suave: se borra del todo
const SHADOW_DARK = 52; // más oscuro que esto ya es prenda
const SHADOW_DEPTH = 24; // hasta cuántos px hacia adentro se busca sombra

const cutoutKeyOf = (key) => `${CUTOUT_FOLDER}/${key.replace(/^products\//, '').replace(/\.[^./]+$/, '')}.w${CUTOUT_WIDTH}.webp`;

/**
 * Quita el fondo liso y claro de una foto de producto. Avanza desde los bordes y solo borra el
 * fondo conectado con ellos, así el blanco de dentro de la prenda (un buso blanco) no se agujerea.
 * Devuelve null si el fondo no es liso (foto con escenario): esa foto se sigue mostrando entera.
 */
async function cutoutBuffer(input, sharp) {
  const { data, info } = await sharp(input)
    .rotate()
    .resize({ width: CUTOUT_WORK, height: CUTOUT_WORK, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: W, height: H } = info;
  const px = (i) => [data[i * 3], data[i * 3 + 1], data[i * 3 + 2]];

  // Color del fondo: mediana del borde. Debe ser claro y casi todo el borde debe parecérsele.
  const border = [];
  for (let x = 0; x < W; x++) border.push(x, (H - 1) * W + x);
  for (let y = 1; y < H - 1; y++) border.push(y * W, y * W + W - 1);
  const channel = (c) => border.map((i) => data[i * 3 + c]).sort((a, b) => a - b)[border.length >> 1];
  const bg = [channel(0), channel(1), channel(2)];
  if (Math.min(...bg) < 200) return null;
  const dist = (i) => {
    const [r, g, b] = px(i);
    return Math.max(Math.abs(r - bg[0]), Math.abs(g - bg[1]), Math.abs(b - bg[2]));
  };
  const plain = border.filter((i) => dist(i) < BG_FAR).length / border.length;
  if (plain < 0.85) return null;

  // Relleno desde los bordes a través del fondo
  const alpha = new Uint8Array(W * H).fill(255);
  const seen = new Uint8Array(W * H);
  const queue = new Int32Array(W * H);
  let head = 0;
  let tail = 0;
  for (const i of border) {
    if (!seen[i] && dist(i) < BG_FAR) {
      seen[i] = 1;
      queue[tail++] = i;
    }
  }
  while (head < tail) {
    const i = queue[head++];
    const d = dist(i);
    alpha[i] = d <= BG_NEAR ? 0 : Math.round(((d - BG_NEAR) / (BG_FAR - BG_NEAR)) * 255);
    if (d > BG_NEAR) continue; // el borde suave no sigue avanzando hacia la prenda
    const x = i % W;
    const y = (i / W) | 0;
    for (const n of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1]) {
      if (n >= 0 && !seen[n] && dist(n) < BG_FAR) {
        seen[n] = 1;
        queue[tail++] = n;
      }
    }
  }

  // Sombra de estudio: gris claro y sin color pegado al fondo. Se borra hasta SHADOW_DEPTH px
  // hacia adentro; una prenda gris de verdad es más oscura que esto y no se toca.
  const lum = (i) => (data[i * 3] * 299 + data[i * 3 + 1] * 587 + data[i * 3 + 2] * 114) / 1000;
  const bgLum = (bg[0] * 299 + bg[1] * 587 + bg[2] * 114) / 1000;
  const shadowAlpha = (i) => {
    const [r, g, b] = px(i);
    if (Math.max(r, g, b) - Math.min(r, g, b) > SHADOW_TINT) return -1;
    const diff = bgLum - lum(i);
    if (diff > SHADOW_DARK) return -1;
    return diff <= SHADOW_LIGHT ? 0 : Math.round(((diff - SHADOW_LIGHT) / (SHADOW_DARK - SHADOW_LIGHT)) * 255);
  };
  const depth = new Uint8Array(W * H);
  head = 0;
  tail = 0;
  for (let i = 0; i < W * H; i++) if (seen[i] && alpha[i] === 0) queue[tail++] = i;
  while (head < tail) {
    const i = queue[head++];
    if (depth[i] >= SHADOW_DEPTH) continue;
    const x = i % W;
    const y = (i / W) | 0;
    for (const n of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1]) {
      if (n < 0 || (seen[n] && alpha[n] === 0)) continue;
      const a = shadowAlpha(n);
      if (a < 0 || a >= alpha[n]) continue;
      alpha[n] = a;
      seen[n] = 1;
      depth[n] = depth[i] + 1;
      if (a < 128) queue[tail++] = n;
    }
  }

  // Si casi no quedó prenda (o casi no hubo fondo), el recorte no es confiable
  let kept = 0;
  for (let i = 0; i < W * H; i++) if (alpha[i] > 128) kept++;
  const ratio = kept / (W * H);
  if (ratio < 0.08 || ratio > 0.97) return null;

  // El contorno de la foto mezcla prenda y fondo (un anillo clarito en prendas oscuras):
  // se encoge el borde 2 px y luego se suaviza para que no quede serruchado.
  let mask = alpha;
  for (let pass = 0; pass < 2; pass++) {
    const next = new Uint8Array(mask);
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        if (mask[i] === 0) continue;
        next[i] = Math.min(mask[i], mask[i - 1], mask[i + 1], mask[i - W], mask[i + W]);
      }
    }
    mask = next;
  }
  const soft = new Uint8Array(mask);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const around = mask[i - W - 1] + mask[i - W] + mask[i - W + 1] + mask[i - 1] + mask[i] + mask[i + 1] + mask[i + W - 1] + mask[i + W] + mask[i + W + 1];
      if (around !== 9 * 255 && around !== 0) soft[i] = Math.round(around / 9);
    }
  }
  alpha.set(soft);

  // RGBA quitando el halo blanco de los bordes semitransparentes
  const rgba = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const a = alpha[i] / 255;
    for (let c = 0; c < 3; c++) {
      const v = data[i * 3 + c];
      rgba[i * 4 + c] = a > 0 && a < 1 ? Math.max(0, Math.min(255, Math.round((v - (1 - a) * bg[c]) / a))) : v;
    }
    rgba[i * 4 + 3] = alpha[i];
  }

  return sharp(rgba, { raw: { width: W, height: H, channels: 4 } })
    .trim({ threshold: 1 })
    .resize({ width: CUTOUT_WIDTH, withoutEnlargement: true })
    .webp({ quality: 82, alphaQuality: 90 })
    .toBuffer();
}

/** Crea (si no existe) el recorte de una foto; null si la foto no tiene un fondo liso. */
async function createCutout(url, client = getS3Client()) {
  const key = keyOf(url);
  if (!key || key.startsWith(`${THUMB_FOLDER}/`) || key.startsWith(`${CUTOUT_FOLDER}/`)) return null;
  const sharp = loadSharp();
  if (!sharp) return null;

  const outKey = cutoutKeyOf(key);
  if (!(await exists(client, outKey))) {
    const original = await client.send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
    const output = await cutoutBuffer(Buffer.from(await original.Body.transformToByteArray()), sharp);
    if (!output) return null;
    await client.send(new PutObjectCommand({
      Bucket: bucket(),
      Key: outKey,
      Body: output,
      ContentType: 'image/webp',
      CacheControl: 'public, max-age=31536000, immutable',
    }));
  }
  return bucketUrl() + encodeKey(outKey);
}

/**
 * Recortes de las fotos que usa la tienda virtual (las suyas o, si no tiene, las de la tienda).
 * `previous` guarda también las fotos sin recorte posible (valor null) para no reintentarlas.
 */
async function buildCutouts(urls, previous = {}) {
  const unique = [...new Set(urls.filter(Boolean))];
  const result = {};
  const pending = [];
  for (const url of unique) {
    if (previous && url in previous) result[url] = previous[url];
    else if (keyOf(url)) pending.push(url);
  }
  if (pending.length === 0) return result;

  const client = getS3Client();
  for (let i = 0; i < pending.length; i += CONCURRENCY) {
    await Promise.all(
      pending.slice(i, i + CONCURRENCY).map(async (url) => {
        try {
          result[url] = await createCutout(url, client);
        } catch (err) {
          console.error('[productImages] No se pudo recortar', url, err.message);
        }
      })
    );
  }
  return result;
}

/** Fotos que muestra la tienda virtual: las propias o, si no tiene, las de la tienda. */
const virtualStorePhotos = (product) =>
  (product.virtualStoreImages || []).length ? product.virtualStoreImages : product.images || [];

/** Todas las fotos del producto (tienda + lookbook + tienda virtual), sin repetir. */
const allProductImages = (product) => [
  ...(product.images || []),
  ...(product.lookbookImages || []),
  ...(product.virtualStoreImages || []),
];

module.exports = {
  CHANNEL_FIELDS,
  validateChannelImages,
  buildThumbnails,
  createThumbnail,
  allProductImages,
  thumbKeyOf,
  keyOf,
  cutoutBuffer,
  buildCutouts,
  virtualStorePhotos,
};
