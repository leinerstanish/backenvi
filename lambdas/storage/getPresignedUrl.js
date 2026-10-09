'use strict';

const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const crypto = require('crypto');

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
    const { fileName, fileType } = body;

    if (!fileName || !fileType) {
      return response(400, { error: 'fileName and fileType are required' });
    }

    const bucketName = process.env.AWS_S3_BUCKET || 'gnfls';
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
