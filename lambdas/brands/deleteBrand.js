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

    await brandRepository.delete(brandId);

    return response(200, { message: 'Brand deleted successfully' });
  } catch (error) {
    console.error('Error:', error);
    return response(500, { error: error.message });
  }
};
