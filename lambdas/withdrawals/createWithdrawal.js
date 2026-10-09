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
    const body = JSON.parse(event.body || '{}');
    const { amount, observation, date, userId } = body;

    if (!amount || amount <= 0) {
      return response(400, { error: 'Amount must be greater than 0' });
    }

    const withdrawal = await withdrawalRepository.create({
      amount,
      observation,
      date,
      userId
    });

    return response(201, withdrawal);
  } catch (error) {
    console.error('Error:', error);
    return response(500, { error: error.message });
  }
};
