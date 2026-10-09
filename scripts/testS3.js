// Load env manually
const fs = require('fs');
const envFile = fs.readFileSync('/Users/leinermena/code/gitlab.com/local/proStore/back/.env', 'utf-8');
envFile.split('\n').forEach(line => {
  const [k, ...v] = line.split('=');
  if (k && v.length) process.env[k.trim()] = v.join('=').trim().replace(/^"|"$/g, '');
});

const s3Service = require('../lambdas/shared/s3Service');

// Minimal 1x1 PNG in base64
const fakeBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

console.log('Bucket:', process.env.AWS_S3_BUCKET);
console.log('Region:', process.env.AWS_S3_REGION);
console.log('Key ID set:', !!process.env.AWS_ACCESS_KEY_ID);

s3Service.processImages([fakeBase64], 'test').then(urls => {
  console.log('Upload OK! Result URLs:', urls);
}).catch(err => {
  console.error('Upload FAILED:', err.message || err);
  console.error('Code:', err.$metadata?.httpStatusCode, err.Code || err.name);
});
