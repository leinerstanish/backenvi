'use strict';

const crypto = require('crypto');
const { HttpError } = require('./catalogRules');

/**
 * Modelo 3D del producto (un archivo GLB). Se muestra en la ficha del producto y en la tienda
 * virtual con un visor que se puede girar y, en el celular, ver en realidad aumentada.
 */

const MODEL_TYPE = 'model/gltf-binary';
const MAX_MODEL_BYTES = 25 * 1024 * 1024;
const MODEL_FOLDER = 'products/models';

const bucketUrl = () => {
  const bucket = process.env.AWS_S3_BUCKET || 'gnfls';
  const region = process.env.AWS_S3_REGION || 'us-east-2';
  return `https://${bucket}.s3.${region}.amazonaws.com/`;
};

const isModelType = (fileType) => String(fileType || '').toLowerCase() === MODEL_TYPE;

/** Valida tamaño de un GLB antes de firmar su subida y devuelve la llave en S3. */
function modelUploadKey(fileSize) {
  const size = Number(fileSize);
  if (!Number.isInteger(size) || size <= 0) {
    throw new HttpError(400, 'fileSize requerido para subir modelos 3D');
  }
  if (size > MAX_MODEL_BYTES) {
    throw new HttpError(400, `El modelo 3D supera el máximo de ${MAX_MODEL_BYTES / (1024 * 1024)} MB`);
  }
  return `${MODEL_FOLDER}/${Date.now()}-${crypto.randomBytes(6).toString('hex')}.glb`;
}

/**
 * Normaliza el modelo 3D que trae la petición. undefined = no tocar; null o '' = quitarlo.
 * Solo se aceptan modelos subidos a nuestro bucket desde el editor.
 */
function validateProductModel(value) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const url = String(value).trim();
  if (!url.startsWith(`${bucketUrl()}${MODEL_FOLDER}/`) || !url.endsWith('.glb') || url.includes('?')) {
    throw new HttpError(400, 'El modelo 3D tiene una URL no válida. Súbelo de nuevo desde el editor.');
  }
  return url;
}

module.exports = { MODEL_TYPE, MAX_MODEL_BYTES, isModelType, modelUploadKey, validateProductModel };
