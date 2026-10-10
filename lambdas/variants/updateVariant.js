'use strict';

const variantRepository = require('../shared/variantRepository');
const s3Service = require('../shared/s3Service');
const inventoryRepository = require('../shared/inventoryRepository');
const locationRepository = require('../shared/locationRepository');
const productRepository = require('../shared/productRepository');
const { loadAttributeIndex, validateVariant, FULFILLMENT, HttpError } = require('../shared/catalogRules');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Credentials': true,
};

const response = (statusCode, body) => ({
  statusCode,
  headers: CORS_HEADERS,
  body: JSON.stringify(body)
});

const EDITABLE_FIELDS = ['sku', 'price', 'stock', 'attributes'];

module.exports.handler = async (event) => {
  try {
    const { variantId } = event.pathParameters || {};
    const body = JSON.parse(event.body || '{}');

    const current = await variantRepository.getOne(variantId);
    if (!current) {
      return response(404, { error: 'Variant not found' });
    }

    if (current.kind === 'COMBO') {
      throw new HttpError(400, 'Las variantes de un combo se administran desde el combo');
    }

    const product = await productRepository.getOne(current.productId);
    if (body.stock !== undefined && product && product.fulfillment === FULFILLMENT.EXTERNAL) {
      throw new HttpError(400, 'Un producto externo no maneja inventario');
    }

    const index = await loadAttributeIndex();
    const merged = validateVariant({ ...current, ...body }, index);

    const updates = {};
    EDITABLE_FIELDS.forEach((field) => {
      if (body[field] !== undefined) updates[field] = merged[field];
    });
    if (body.images !== undefined) {
      updates.images = await s3Service.processImages(merged.images, 'variants');
    }

    await variantRepository.update(variantId, updates);

    if (body.stock !== undefined) {
      const location = await locationRepository.getDefault();
      await inventoryRepository.setVariantStock(current, merged.stock, location.locationId);
    }

    return response(200, await variantRepository.getOne(variantId));
  } catch (error) {
    if (error.statusCode) {
      return response(error.statusCode, { error: error.message, message: error.message });
    }
    console.error('Error:', error);
    return response(500, { error: error.message });
  }
};
