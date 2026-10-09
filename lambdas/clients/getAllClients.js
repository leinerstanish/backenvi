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
    const clients = await clientRepository.getAll();
    return response(200, { items: clients, total: clients.length });
  } catch (error) {
    console.error('Error in getAllClients:', error);
    return response(500, { error: error.message });
  }
};
