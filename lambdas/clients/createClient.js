'use strict';

const clientRepository = require('../shared/clientRepository');

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
    const { name, email, phone, documentId, address } = JSON.parse(event.body || '{}');

    if (!name) {
      return response(400, { error: 'El nombre del cliente es requerido' });
    }

    const newClient = await clientRepository.create({ name, email, phone, documentId, address });
    return response(201, newClient);
  } catch (error) {
    console.error('Error in createClient:', error);
    return response(500, { error: error.message });
  }
};
