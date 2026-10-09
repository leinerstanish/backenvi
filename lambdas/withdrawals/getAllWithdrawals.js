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
    const withdrawals = await withdrawalRepository.getAll();

    const total = withdrawals.reduce((sum, w) => sum + (w.amount || 0), 0);

    return response(200, {
      items: withdrawals,
      total: withdrawals.length,
      totalAmount: total
    });
  } catch (error) {
    console.error('Error:', error);
    return response(500, { error: error.message });
  }
};
