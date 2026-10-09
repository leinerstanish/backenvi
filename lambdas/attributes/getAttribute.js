'use strict';

const attributeRepository = require('../shared/attributeRepository');

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
    const { attributeId } = event.pathParameters || {};

    const attribute = await attributeRepository.getOne(attributeId);

    if (!attribute) {
      return response(404, { error: 'Attribute not found' });
    }

    return response(200, attribute);
  } catch (error) {
    console.error('Error:', error);
    return response(500, { error: error.message });
  }
};
