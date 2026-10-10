'use strict';

const variantRepository = require('../shared/variantRepository');
const productRepository = require('../shared/productRepository');
const s3Service = require('../shared/s3Service');
const locationRepository = require('../shared/locationRepository');
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

module.exports.handler = async (event) => {
  try {
    const body = JSON.parse(event.body || '{}');

    if (!body.productId) {
      return response(400, { error: 'productId required', message: 'productId required' });
    }

    const product = await productRepository.getOne(body.productId);
    if (!product) {
      return response(404, { error: 'Product not found' });
    }

    const index = await loadAttributeIndex();
    const validated = validateVariant(body, index);
    const images = await s3Service.processImages(validated.images, 'variants');

    if (product.kind === 'COMBO') {
      throw new HttpError(400, 'Las variantes de un combo se generan desde el combo');
    }
    const isExternal = product.fulfillment === FULFILLMENT.EXTERNAL;
    if (isExternal && validated.stock > 0) {
      throw new HttpError(400, 'Un producto externo no maneja inventario: el stock de la variante debe ser 0');
    }
    const location = isExternal ? null : await locationRepository.getDefault();
    const variant = await variantRepository.create({
      ...validated,
      productId: body.productId,
      images
    }, location ? location.locationId : null);

    return response(201, variant);
  } catch (error) {
    if (error.statusCode) {
      return response(error.statusCode, { error: error.message, message: error.message });
    }
    console.error('Error:', error);
    return response(500, { error: error.message, message: error.message });
  }
};
