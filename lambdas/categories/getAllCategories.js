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
    const { parentId } = event.queryStringParameters || {};

    let categories;
    if (parentId) {
      categories = await categoryRepository.getByParentId(parentId);
    } else {
      categories = await categoryRepository.getAll();
    }
    
    return response(200, categories);
  } catch (error) {
    console.error('Error:', error);
    return response(500, { error: error.message });
  }
};
