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
    let locations = await locationRepository.getAll();
    if (locations.length === 0) {
      const defaultLoc = await locationRepository.getDefault();
      locations = [defaultLoc];
    }
    return response(200, { items: locations, total: locations.length });
  } catch (error) {
    console.error('Error in getAllLocations:', error);
    return response(500, { error: error.message });
  }
};
