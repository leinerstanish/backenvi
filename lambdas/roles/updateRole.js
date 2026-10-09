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
    const { roleId } = event.pathParameters || {};
    const updates = JSON.parse(event.body || '{}');

    const role = await roleRepository.update(roleId, updates);

    if (!role) {
      return response(404, { error: 'Role not found' });
    }

    return response(200, role);
  } catch (error) {
    console.error('Error:', error);
    return response(500, { error: error.message });
  }
};
