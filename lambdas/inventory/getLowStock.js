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
    const items = await inventoryRepository.getLowStock();
    return response(200, { items, total: items.length });
  } catch (error) {
    console.error('Error in getLowStock:', error);
    return response(500, { error: error.message });
  }
};
