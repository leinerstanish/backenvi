'use strict';

const reviewRepository = require('../shared/reviewRepository');
const { isAdminRequest } = require('../shared/auth');

const CORS_HEADERS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Credentials': true };
const response = (statusCode, body) => ({ statusCode, headers: CORS_HEADERS, body: JSON.stringify(body) });

const STATUSES = ['APPROVED', 'REJECTED'];

module.exports.handler = async (event) => {
  try {
    if (!isAdminRequest(event)) {
      return response(401, { error: 'Sesión de administrador requerida' });
    }

    const { reviewId } = event.pathParameters || {};
    const { status } = JSON.parse(event.body || '{}');
    if (!STATUSES.includes(status)) {
      return response(400, { error: 'status debe ser APPROVED o REJECTED' });
    }

    try {
      const review = await reviewRepository.setStatus(decodeURIComponent(reviewId), status);
      return response(200, review);
    } catch (error) {
      if (error.name === 'ConditionalCheckFailedException') {
        return response(404, { error: 'Reseña no encontrada' });
      }
      throw error;
    }
  } catch (error) {
    console.error('Error in updateReviewStatus:', error);
    return response(500, { error: error.message });
  }
};
