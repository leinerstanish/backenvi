'use strict';

const brandRepository = require('../shared/brandRepository');

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
    const { brandId } = event.pathParameters || {};

    const brand = await brandRepository.getOne(brandId);

    if (!brand) {
      return response(404, { error: 'Brand not found' });
    }

    return response(200, brand);
  } catch (error) {
    console.error('Error:', error);
    return response(500, { error: error.message });
  }
};
