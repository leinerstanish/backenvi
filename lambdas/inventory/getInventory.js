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
    const qp = event.queryStringParameters || {};
    const search = qp.search || '';
    const warehouseId = qp.warehouseId || qp.locationId || null;
    const productId = qp.productId || null;

    const items = await inventoryRepository.getAll({
      search,
      warehouseId,
      productId,
      autoSync: true
    });

    return response(200, { items, total: items.length });
  } catch (error) {
    console.error('Error in getInventory:', error);
    return response(500, { error: error.message });
  }
};
