'use strict';

const locationRepository = require('../shared/locationRepository');

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
    const { locationId } = event.pathParameters || {};
    if (!locationId) {
      return response(400, { error: 'locationId is required' });
    }

    const updates = JSON.parse(event.body || '{}');
    const updated = await locationRepository.update(locationId, updates);

    return response(200, updated);
  } catch (error) {
    console.error('Error in updateLocation:', error);
    return response(500, { error: error.message });
  }
};
