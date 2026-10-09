'use strict';

const productRepository = require('../shared/productRepository');
const variantRepository = require('../shared/variantRepository');
const { presentProduct } = require('../shared/auth');

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
    const [products, variants] = await Promise.all([
      productRepository.getAll(),
      variantRepository.getAll()
    ]);

    const variantsByProduct = variants.reduce((acc, v) => {
      (acc[v.productId] = acc[v.productId] || []).push(v);
      return acc;
    }, {});

    const items = products.map((p) => {
      const productVariants = variantsByProduct[p.productId] || [];
      return presentProduct(event, {
        ...p,
        variants: productVariants,
        variantCount: productVariants.length,
        status: productVariants.length > 0 ? 'ACTIVE' : 'PENDING_VARIANTS'
      });
    });

    return response(200, { items, total: items.length });
  } catch (error) {
    console.error('Error:', error);
    return response(500, { error: error.message, message: error.message });
  }
};
