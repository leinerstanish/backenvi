'use strict';

const variantRepository = require('../shared/variantRepository');

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
    const { productId } = event.queryStringParameters || {};

    let variants;
    if (productId) {
      variants = await variantRepository.getByProductId(productId);
    } else {
      variants = await variantRepository.getAll();
    }

    return response(200, variants);
  } catch (error) {
    console.error('Error:', error);
    return response(500, { error: error.message });
  }
};
