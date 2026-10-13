'use strict';

const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const crypto = require('crypto');
const { isAdminRequest } = require('../shared/auth');
const { isVideoType, videoUploadKey } = require('../shared/productVideos');

const s3Client = new S3Client({
  region: process.env.AWS_S3_REGION || 'us-east-2'
});

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Credentials': true,
};

const response = (statusCode, body) => ({
  statusCode,
  headers: CORS_HEADERS,
  body: JSON.stringify(body)
});

module.exports.handler = async (event) => {
  try {
    const body = JSON.parse(event.body || '{}');
    const { fileName, fileType, fileSize } = body;

    if (!fileName || !fileType) {
      return response(400, { error: 'fileName and fileType are required' });
    }

    const bucketName = process.env.AWS_S3_BUCKET || 'gnfls';

    // Videos de producto: solo administradores, con tipo y tamaño validados y firmados.
    // Las imágenes (productos y fotos de reseñas) siguen el flujo de siempre.
    if (isVideoType(fileType)) {
      if (!isAdminRequest(event)) {
        return response(401, { error: 'Sesión de administrador requerida para subir videos' });
      }
      let videoKey;
      try {
        videoKey = videoUploadKey(fileType, fileSize);
      } catch (error) {
        return response(error.statusCode || 400, { error: error.message, message: error.message });
      }

      const videoCommand = new PutObjectCommand({
        Bucket: bucketName,
        Key: videoKey,
        ContentType: fileType,
        ContentLength: Number(fileSize),
      });
      const videoUrl = await getSignedUrl(s3Client, videoCommand, { expiresIn: 3600 });

      return response(200, {
        presignedUrl: videoUrl,
        fileKey: videoKey,
        bucket: bucketName,
        region: process.env.AWS_S3_REGION || 'us-east-2'
      });
    }

    const key = `products/${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${fileName}`;

    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      ContentType: fileType,
    });

    const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });

    return response(200, {
      presignedUrl,
      fileKey: key,
      bucket: bucketName,
      region: process.env.AWS_S3_REGION || 'us-east-2'
    });
  } catch (error) {
    console.error('Error:', error);
    return response(500, { error: error.message });
  }
};
