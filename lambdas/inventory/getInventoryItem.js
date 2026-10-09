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

    const item = await inventoryRepository.getOne(id);
    if (!item) {
      return response(404, { error: 'Inventory item not found' });
    }

    return response(200, item);
  } catch (error) {
    console.error('Error in getInventoryItem:', error);
    return response(500, { error: error.message });
  }
};
