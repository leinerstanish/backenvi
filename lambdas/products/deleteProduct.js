'use strict';

const productRepository = require('../shared/productRepository');
const variantRepository = require('../shared/variantRepository');
const saleRepository = require('../shared/saleRepository');

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
    const { productId } = event.pathParameters || {};

    const product = await productRepository.getOne(productId);
    if (!product) {
      return response(404, { error: 'Product not found' });
    }

    if (await saleRepository.hasSalesForProduct(productId)) {
      return response(409, { error: 'No se puede eliminar: el producto tiene ventas registradas' });
    }

    const variants = await variantRepository.getByProductId(productId);
    for (const variant of variants) {
      if ((await variantRepository.stockOf(variant.variantId)) > 0) {
        return response(409, { error: 'El producto tiene unidades en inventario. Ajusta el stock a 0 antes de eliminarlo' });
      }
    }
    for (const variant of variants) {
      await variantRepository.delete(variant.variantId);
    }
    await productRepository.delete(productId);

    return response(200, { message: 'Product deleted successfully' });
  } catch (error) {
    console.error('Error:', error);
    return response(500, { error: error.message });
  }
};
