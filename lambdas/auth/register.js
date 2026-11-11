'use strict';

const jwt = require('jsonwebtoken');
const userRepository = require('../shared/userRepository');
const { isAdminRequest } = require('../shared/auth');

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
    if (!isAdminRequest(event)) {
      return response(403, {
        error: 'El registro público está deshabilitado. Los usuarios solo pueden ser creados desde el panel de administración.'
      });
    }

    const { email, firstName, lastName, password } = JSON.parse(event.body || '{}');

    if (!email || !password) {
      return response(400, { error: 'Email and password required' });
    }

    const existing = await userRepository.findByEmail(email);
    if (existing) {
      return response(409, { error: 'Email already registered' });
    }

    const user = await userRepository.create({
      email,
      firstName,
      lastName,
      password
    });

    const token = jwt.sign(
      { userId: user.userId, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
    );

    return response(201, {
      user,
      token
    });
  } catch (error) {
    console.error('Error:', error);
    return response(500, { error: error.message });
  }
};
