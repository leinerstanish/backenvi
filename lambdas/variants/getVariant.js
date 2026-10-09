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
    const { variantId } = event.pathParameters || {};

    const variant = await variantRepository.getOne(variantId);

    if (!variant) {
      return response(404, { error: 'Variant not found' });
    }

    return response(200, variant);
  } catch (error) {
    console.error('Error:', error);
    return response(500, { error: error.message });
  }
};
