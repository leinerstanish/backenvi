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
    const { name, description, logoUrl } = JSON.parse(event.body || '{}');

    if (!name) {
      return response(400, { error: 'Name required' });
    }

    const brand = await brandRepository.create({
      name,
      description: description || '',
      logoUrl: logoUrl || ''
    });

    return response(201, brand);
  } catch (error) {
    console.error('Error:', error);
    return response(500, { error: error.message });
  }
};
