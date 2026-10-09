'use strict';

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
    const { variantId } = event.pathParameters || {};

    const variant = await variantRepository.getOne(variantId);
    if (!variant) {
      return response(404, { error: 'Variant not found' });
    }

    const siblings = await variantRepository.getByProductId(variant.productId);
    if (siblings.length <= 1) {
      return response(409, { error: 'El producto debe tener al menos una variante' });
    }

    const stock = await variantRepository.stockOf(variantId);
    if (stock > 0) {
      return response(409, { error: `La variante tiene ${stock} unidades en inventario. Ajusta el stock a 0 antes de eliminarla` });
    }

    if (await saleRepository.hasSalesForProduct(variant.productId)) {
      return response(409, { error: 'No se puede eliminar: el producto de esta variante tiene ventas registradas' });
    }

    await variantRepository.delete(variantId);

    return response(200, { message: 'Variant deleted successfully' });
  } catch (error) {
    console.error('Error:', error);
    return response(500, { error: error.message });
  }
};
