'use strict';

const reviewRepository = require('../shared/reviewRepository');

const CORS_HEADERS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Credentials': true };
const response = (statusCode, body) => ({ statusCode, headers: CORS_HEADERS, body: JSON.stringify(body) });

module.exports.handler = async (event) => {
  try {
    const { productId } = event.pathParameters || {};
    const approved = await reviewRepository.getApprovedByProduct(productId);

    const items = approved
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((r) => ({
        reviewId: r.reviewId,
        rating: r.rating,
        comment: r.comment,
        photos: r.photos,
        customerName: r.customerName || 'Cliente verificado',
        createdAt: r.createdAt
      }));

    const average = items.length ? Math.round((items.reduce((s, r) => s + r.rating, 0) / items.length) * 10) / 10 : 0;

    return response(200, { average, count: items.length, items });
  } catch (error) {
    console.error('Error in getProductReviews:', error);
    return response(500, { error: error.message });
  }
};
