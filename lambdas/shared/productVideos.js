'use strict';

const crypto = require('crypto');
const { HttpError } = require('./catalogRules');

const MAX_PRODUCT_VIDEOS = 5;
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const VIDEO_TYPES = { 'video/mp4': 'mp4', 'video/webm': 'webm' };
const VIDEO_FOLDER = 'products/videos';

const bucketUrl = () => {
  const bucket = process.env.AWS_S3_BUCKET || 'gnfls';
  const region = process.env.AWS_S3_REGION || 'us-east-2';
  return `https://${bucket}.s3.${region}.amazonaws.com/`;
};

const isVideoType = (fileType) => String(fileType || '').toLowerCase().startsWith('video/');

/** Valida tipo y tamaño de un video antes de firmar su subida y devuelve la llave en S3. */
function videoUploadKey(fileType, fileSize) {
  const extension = VIDEO_TYPES[String(fileType).toLowerCase()];
  if (!extension) {
    throw new HttpError(400, 'Formato de video no soportado. Usa MP4 o WebM.');
  }
  const size = Number(fileSize);
  if (!Number.isInteger(size) || size <= 0) {
    throw new HttpError(400, 'fileSize requerido para subir videos');
  }
  if (size > MAX_VIDEO_BYTES) {
    throw new HttpError(400, `El video supera el máximo de ${MAX_VIDEO_BYTES / (1024 * 1024)} MB`);
  }
  return `${VIDEO_FOLDER}/${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${extension}`;
}

/**
 * Normaliza la lista de videos de un producto. undefined significa "no tocar" (los productos y
 * clientes existentes no envían este campo). Solo se aceptan videos subidos a nuestro bucket.
 */
function validateProductVideos(videos) {
  if (videos === undefined) return undefined;
  if (videos === null) return [];
  if (!Array.isArray(videos)) throw new HttpError(400, 'videos debe ser una lista de URLs');

  const prefix = `${bucketUrl()}${VIDEO_FOLDER}/`;
  const unique = [...new Set(videos.map((v) => String(v || '').trim()).filter(Boolean))];

  if (unique.length > MAX_PRODUCT_VIDEOS) {
    throw new HttpError(400, `Un producto admite máximo ${MAX_PRODUCT_VIDEOS} videos`);
  }
  for (const url of unique) {
    if (!url.startsWith(prefix) || url.includes('?')) {
      throw new HttpError(400, 'Hay un video con una URL no válida. Súbelo de nuevo desde el editor.');
    }
  }
  return unique;
}

module.exports = { MAX_PRODUCT_VIDEOS, MAX_VIDEO_BYTES, VIDEO_TYPES, isVideoType, videoUploadKey, validateProductVideos };
