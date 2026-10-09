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
    const { name, description, parentId } = JSON.parse(event.body || '{}');

    if (!name) {
      return response(400, { error: 'Name required' });
    }

    const categoryData = {
      name,
      description: description || ''
    };

    if (parentId) {
      categoryData.parentId = parentId;
    }

    const category = await categoryRepository.create(categoryData);

    return response(201, category);
  } catch (error) {
    console.error('Error:', error);
    return response(500, { error: error.message });
  }
};
