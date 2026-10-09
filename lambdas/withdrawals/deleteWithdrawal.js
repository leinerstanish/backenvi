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

    const withdrawal = await withdrawalRepository.getOne(withdrawalId);

    if (!withdrawal) {
      return response(404, { error: 'Withdrawal not found' });
    }

    await withdrawalRepository.delete(withdrawalId);

    return response(200, { message: 'Withdrawal deleted successfully' });
  } catch (error) {
    console.error('Error:', error);
    return response(500, { error: error.message });
  }
};
