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
    const { productId, variantId, warehouseId, locationId, quantity, reservedQuantity, reorderLevel, notes } = JSON.parse(event.body || '{}');

    if (!productId) {
      return response(400, { error: 'productId is required' });
    }

    const item = await inventoryRepository.create({
      productId,
      variantId: variantId || null,
      warehouseId: warehouseId || locationId,
      quantity: quantity || 0,
      reservedQuantity: reservedQuantity || 0,
      reorderLevel: reorderLevel || 10,
      notes: notes || 'Creación manual de inventario'
    });

    return response(201, item);
  } catch (error) {
    console.error('Error in createInventory:', error);
    return response(500, { error: error.message });
  }
};
