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
};
