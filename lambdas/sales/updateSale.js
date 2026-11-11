'use strict';

const saleRepository = require('../shared/saleRepository');
const { generateReceipt } = require('../shared/receiptService');

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
    const { saleId } = event.pathParameters || {};
    const updates = JSON.parse(event.body || '{}');

    const sale = await saleRepository.update(saleId, updates);

    if (!sale) {
      return response(404, { error: 'Sale not found' });
    }

    if (Array.isArray(updates.items) || updates.shippingFee !== undefined || updates.saleType !== undefined) {
      try {
        await generateReceipt(saleId);
      } catch (receiptError) {
        console.error('Receipt regeneration failed (sale update kept):', receiptError.message);
      }
    }

    return response(200, sale);
  } catch (error) {
    console.error('Error:', error);
    return response(500, { error: error.message });
  }
};
