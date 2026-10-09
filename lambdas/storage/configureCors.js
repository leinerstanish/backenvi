'use strict';

const { S3Client, PutBucketCorsCommand } = require('@aws-sdk/client-s3');

const s3Client = new S3Client({
  region: process.env.AWS_S3_REGION || 'us-east-2'
});

const CORS_CONFIGURATION = {
  CORSRules: [
    {
      AllowedMethods: ['GET', 'HEAD', 'PUT', 'POST', 'DELETE'],
      AllowedOrigins: ['*'],
      AllowedHeaders: ['*'],
      ExposeHeaders: ['ETag', 'x-amz-version-id'],
      MaxAgeSeconds: 3000,
    },
  ],
};

module.exports.handler = async (event) => {
  try {
    const bucketName = process.env.AWS_S3_BUCKET || 'gnfls';

    console.log(`Configuring CORS for bucket: ${bucketName}`);

    const command = new PutBucketCorsCommand({
      Bucket: bucketName,
      CORSConfiguration: CORS_CONFIGURATION,
    });

    await s3Client.send(command);

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'CORS configuration applied successfully',
        bucket: bucketName,
        corsRules: CORS_CONFIGURATION.CORSRules,
      }),
    };
  } catch (error) {
    console.error('Error configuring CORS:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
