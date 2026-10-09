'use strict';

const jwt = require('jsonwebtoken');
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
    const { email, password } = JSON.parse(event.body || '{}');

    if (!email || !password) {
      return response(400, { error: 'Email and password required' });
    }

    const user = await userRepository.findByEmail(email);
    if (!user) {
      return response(401, { error: 'Invalid credentials' });
    }

    const validPassword = userRepository.verifyPassword(password, user.passwordHash, user.salt);
    if (!validPassword) {
      return response(401, { error: 'Invalid credentials' });
    }

    const { passwordHash, salt, ...safeUser } = user;

    const token = jwt.sign(
      { userId: user.userId, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
    );

    return response(200, {
      user: safeUser,
      token
    });
  } catch (error) {
    console.error('Error:', error);
    return response(500, { error: error.message });
  }
};
