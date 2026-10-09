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
    const { name, code, address, location, isDefault } = JSON.parse(event.body || '{}');

    if (!name) {
      return response(400, { error: 'Name is required' });
    }

    const newLocation = await locationRepository.create({
      name,
      code: code || 'BOD-01',
      address: address || location || '',
      location: location || address || '',
      isDefault: Boolean(isDefault)
    });

    return response(201, newLocation);
  } catch (error) {
    console.error('Error in createLocation:', error);
    return response(500, { error: error.message });
  }
};
