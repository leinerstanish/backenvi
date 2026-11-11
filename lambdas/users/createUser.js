'use strict';

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
      return response(401, {
        error: 'Sesión de administrador requerida para crear usuarios'
      });
    }

    const { email, firstName, lastName, password } = JSON.parse(event.body || '{}');

    if (!email || !password) {
      return response(400, { error: 'Email and password required' });
    }

    const existing = await userRepository.findByEmail(email);
    if (existing) {
      return response(409, { error: 'El correo ya está registrado' });
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
