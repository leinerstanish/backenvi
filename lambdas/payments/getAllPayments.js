'use strict';

const paymentRepository = require('../shared/paymentRepository');
const saleRepository = require('../shared/saleRepository');
const clientRepository = require('../shared/clientRepository');

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
    const qp = event.queryStringParameters || {};
    const { saleId, clientId } = qp;

    let payments = await paymentRepository.getAll({ saleId });

    // Filter by clientId if requested
    if (clientId) {
      payments = payments.filter(p => p.clientId === clientId);
    }

    // Enrich each payment with sale info
    const enriched = await Promise.all(payments.map(async (payment) => {
      let saleInfo = null;
      let clientInfo = null;
      try {
        if (payment.saleId) saleInfo = await saleRepository.getOne(payment.saleId);
        if (payment.clientId) clientInfo = await clientRepository.getOne(payment.clientId);
      } catch (_) {}
      return { ...payment, sale: saleInfo, client: clientInfo };
    }));

    enriched.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return response(200, { items: enriched, total: enriched.length });
  } catch (error) {
    console.error('Error in getAllPayments:', error);
    return response(500, { error: error.message });
  }
};
