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
    const user = await userRepository.getOne(userId);

    if (!user) {
      return response(404, { error: 'User not found' });
    }

    return response(200, user);
  } catch (error) {
    console.error('Error:', error);
    return response(500, { error: error.message });
  }
};
