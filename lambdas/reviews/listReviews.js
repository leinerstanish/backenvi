'use strict';

const reviewRepository = require('../shared/reviewRepository');
const { isAdminRequest } = require('../shared/auth');

const CORS_HEADERS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Credentials': true };
const response = (statusCode, body) => ({ statusCode, headers: CORS_HEADERS, body: JSON.stringify(body) });

module.exports.handler = async (event) => {
  try {
    if (!isAdminRequest(event)) {
      return response(401, { error: 'Sesión de administrador requerida' });
    }

    const status = event.queryStringParameters?.status;
    let items = await reviewRepository.getAll();
    if (status) items = items.filter((r) => r.status === status);
    items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    return response(200, { items, total: items.length });
  } catch (error) {
    console.error('Error in listReviews:', error);
    return response(500, { error: error.message });
  }
};
