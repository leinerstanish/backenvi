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

    const updates = JSON.parse(event.body || '{}');
    const updated = await inventoryRepository.update(id, updates);

    return response(200, updated);
  } catch (error) {
    console.error('Error in updateInventory:', error);
    return response(500, { error: error.message });
  }
};
