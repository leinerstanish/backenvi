'use strict';

const withdrawalRepository = require('../shared/withdrawalRepository');

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
    const { withdrawalId } = event.pathParameters || {};
    const updates = JSON.parse(event.body || '{}');

    const withdrawal = await withdrawalRepository.update(withdrawalId, updates);

    if (!withdrawal) {
      return response(404, { error: 'Withdrawal not found' });
    }

    return response(200, withdrawal);
  } catch (error) {
    console.error('Error:', error);
    return response(500, { error: error.message });
  }
};
