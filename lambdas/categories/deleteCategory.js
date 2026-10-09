'use strict';

const categoryRepository = require('../shared/categoryRepository');

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
    const { categoryId } = event.pathParameters || {};

    await categoryRepository.delete(categoryId);

    return response(200, { message: 'Category deleted successfully' });
  } catch (error) {
    console.error('Error:', error);
    return response(500, { error: error.message });
  }
};
