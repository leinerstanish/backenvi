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

module.exports.handler = async (event) => {
  try {
    const { productId } = event.pathParameters || {};

    const product = await productRepository.getOne(productId);

    if (!product) {
      return response(404, { error: 'Product not found' });
    }

    const [variants, reviews] = await Promise.all([
      variantRepository.getByProductId(productId),
      reviewRepository.getApprovedByProduct(productId)
    ]);
    const status = productStatus(product, variants.length);

    if (status !== 'ACTIVE' && !isAdminRequest(event)) {
      return response(404, { error: 'Product not found' });
    }

    return response(200, presentProduct(event, {
      ...product,
      variants,
      status,
      rating: reviewRepository.ratingSummary(reviews)
    }));
  } catch (error) {
    console.error('Error:', error);
    return response(500, { error: error.message });
  }
};
