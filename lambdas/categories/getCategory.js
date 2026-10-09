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

    const category = await categoryRepository.getOne(categoryId);

    if (!category) {
      return response(404, { error: 'Category not found' });
    }

    return response(200, category);
  } catch (error) {
    console.error('Error:', error);
    return response(500, { error: error.message });
  }
};
