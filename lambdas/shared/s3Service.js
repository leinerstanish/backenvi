'use strict';

const crypto = require('crypto');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

function getS3Client() {
  const region = process.env.AWS_S3_REGION || 'us-east-2';
  const accessKeyId = process.env.S3_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY;

  const config = {
    region,
    endpoint: `https://s3.${region}.amazonaws.com`,
    forcePathStyle: false,
  };

  if (accessKeyId && secretAccessKey) {
    config.credentials = { accessKeyId, secretAccessKey };
  }

  return new S3Client(config);
}

class S3Service {
  /**
   * Receives an array of image strings (base64 data URIs or http URLs).
   * Uploads base64 images to S3 and returns an array of public URLs.
   * Existing http(s) URLs are kept as-is.
   */
  async processImages(images = [], folder = 'products') {
    if (!Array.isArray(images) || images.length === 0) {
      return [];
    }

    const bucket = process.env.AWS_S3_BUCKET || 'gnfls';
    const region = process.env.AWS_S3_REGION || 'us-east-2';
    const s3Client = getS3Client();

    console.log(`[S3Service] Processing ${images.length} image(s). Bucket: ${bucket} | Region: ${region}`);

    const processedUrls = await Promise.all(
      images.map(async (img) => {
        if (typeof img !== 'string') return null;

        // Already a public URL — keep it
        if (img.startsWith('http://') || img.startsWith('https://')) {
          return img;
        }

        // Base64 data URI
        if (img.startsWith('data:image/')) {
          try {
            const matches = img.match(/^data:image\/([a-zA-Z0-9+.=-]+);base64,(.+)$/s);
            if (!matches) {
              console.error('[S3Service] Could not parse base64 string');
              return null;
            }

            const mimeType = matches[1]; // e.g. "jpeg", "png"
            const extension = mimeType === 'jpeg' ? 'jpg' : mimeType;
            const buffer = Buffer.from(matches[2], 'base64');
            const fileName = `${folder}/${Date.now()}_${crypto.randomBytes(6).toString('hex')}.${extension}`;

            await s3Client.send(new PutObjectCommand({
              Bucket: bucket,
              Key: fileName,
              Body: buffer,
              ContentType: `image/${mimeType}`,
            }));

            const publicUrl = `https://${bucket}.s3.${region}.amazonaws.com/${fileName}`;
            console.log('[S3Service] ✅ Uploaded:', publicUrl);
            return publicUrl;
          } catch (err) {
            console.error('[S3Service] ❌ Upload error:', err.message);
            return null;
          }
        }

        console.warn('[S3Service] Unknown image format, skipping.');
        return null;
      })
    );

    return processedUrls.filter(Boolean);
  }
}

module.exports = new S3Service();
