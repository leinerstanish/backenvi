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
    const roles = await roleRepository.getAll();
    return response(200, { roles, total: roles.length });
  } catch (error) {
    console.error('Error:', error);
    return response(500, { error: error.message });
  }
};
