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

    const updates = JSON.parse(event.body || '{}');
    const updated = await clientRepository.update(clientId, updates);
    return response(200, updated);
  } catch (error) {
    console.error('Error in updateClient:', error);
    return response(500, { error: error.message });
  }
};
