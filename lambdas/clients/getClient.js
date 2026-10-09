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
    const { clientId } = event.pathParameters || {};
    if (!clientId) return response(400, { error: 'clientId requerido' });

    const client = await clientRepository.getOne(clientId);
    if (!client) return response(404, { error: 'Cliente no encontrado' });

    return response(200, client);
  } catch (error) {
    console.error('Error in getClient:', error);
    return response(500, { error: error.message });
  }
};
