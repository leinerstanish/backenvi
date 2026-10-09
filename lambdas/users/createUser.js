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
    const { email, firstName, lastName, password } = JSON.parse(event.body || '{}');

    if (!email || !password) {
      return response(400, { error: 'Email and password required' });
    }

    const user = await userRepository.create({
      email,
      firstName,
      lastName,
      password
    });

    return response(201, user);
  } catch (error) {
    console.error('Error:', error);
    return response(500, { error: error.message });
  }
};
