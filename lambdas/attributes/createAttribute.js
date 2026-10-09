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
    const { name, values, type, isRequired, isPublished } = JSON.parse(event.body || '{}');

    if (!name) {
      return response(400, { error: 'Name required' });
    }

    const attribute = await attributeRepository.create({
      name,
      values: values || [],
      type,
      isRequired,
      isPublished
    });

    return response(201, attribute);
  } catch (error) {
    console.error('Error:', error);
    return response(500, { error: error.message });
  }
};
