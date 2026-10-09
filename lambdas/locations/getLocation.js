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

    const location = await locationRepository.getOne(locationId);
    if (!location) {
      return response(404, { error: 'Location not found' });
    }

    return response(200, location);
  } catch (error) {
    console.error('Error in getLocation:', error);
    return response(500, { error: error.message });
  }
};
