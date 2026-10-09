'use strict';

const inventoryRepository = require('../shared/inventoryRepository');

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
    const { id } = event.pathParameters || {};
    if (!id) {
      return response(400, { error: 'Inventory id is required' });
    }

    const { quantity, reason, notes } = JSON.parse(event.body || '{}');

    if (quantity === undefined || quantity === null || isNaN(quantity)) {
      return response(400, { error: 'Valid quantity number is required' });
    }

    const updated = await inventoryRepository.adjustStock(id, {
      quantity: parseInt(quantity, 10),
      reason: reason || 'ADJUSTMENT',
      notes: notes || ''
    });

    return response(200, updated);
  } catch (error) {
    console.error('Error in adjustStock:', error);
    return response(500, { error: error.message });
  }
};
