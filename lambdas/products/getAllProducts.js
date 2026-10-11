'use strict';

const productRepository = require('../shared/productRepository');
const variantRepository = require('../shared/variantRepository');
const reviewRepository = require('../shared/reviewRepository');
const { isAdminRequest, presentProduct } = require('../shared/auth');
const { productStatus } = require('../shared/catalogRules');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Credentials': true,
};

const response = (statusCode, body) => ({
  statusCode,
  headers: CORS_HEADERS,
  body: JSON.stringify(body)
});

const NO_REVIEWS = { average: 0, count: 0 };

module.exports.handler = async (event) => {
  try {
    const [products, variants, ratings] = await Promise.all([
      productRepository.getAll(),
      variantRepository.getAll(),
      reviewRepository.approvedSummaryByProduct()
    ]);

    const variantsByProduct = variants.reduce((acc, v) => {
      (acc[v.productId] = acc[v.productId] || []).push(v);
      return acc;
    }, {});

    // La tienda solo ve lo que se puede vender; el admin ve todo.
    const admin = isAdminRequest(event);

    const items = products
      .map((p) => {
        const productVariants = variantsByProduct[p.productId] || [];
        return presentProduct(event, {
          ...p,
          variants: productVariants,
          variantCount: productVariants.length,
          status: productStatus(p, productVariants.length),
          rating: ratings.get(p.productId) || NO_REVIEWS
        });
      })
      .filter((p) => admin || p.status === 'ACTIVE');

    return response(200, { items, total: items.length });
  } catch (error) {
    console.error('Error:', error);
    return response(500, { error: error.message, message: error.message });
  }
};
