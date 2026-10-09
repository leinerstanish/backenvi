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
    const brands = await brandRepository.getAll();
    return response(200, brands);
  } catch (error) {
    console.error('Error:', error);
    return response(500, { error: error.message });
  }
};
