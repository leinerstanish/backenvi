'use strict';

const userRepository = require('../shared/userRepository');

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
    const { userId } = event.pathParameters || {};
    const deleted = await userRepository.delete(userId);

    if (!deleted) {
      return response(404, { error: 'User not found' });
    }

    return response(200, { message: 'User deleted' });
  } catch (error) {
    console.error('Error:', error);
    return response(500, { error: error.message });
  }
};
