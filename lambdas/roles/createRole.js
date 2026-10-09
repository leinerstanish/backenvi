'use strict';

const roleRepository = require('../shared/roleRepository');

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
    const { name, permissions, description } = JSON.parse(event.body || '{}');

    if (!name) {
      return response(400, { error: 'Name required' });
    }

    const role = await roleRepository.create({
      name,
      permissions: permissions || [],
      description: description || ''
    });

    return response(201, role);
  } catch (error) {
    console.error('Error:', error);
    return response(500, { error: error.message });
  }
};
