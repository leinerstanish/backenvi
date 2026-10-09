'use strict';

const saleRepository = require('../shared/saleRepository');
const clientRepository = require('../shared/clientRepository');
const paymentRepository = require('../shared/paymentRepository');

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
    const { status, saleType, clientId } = qp;

    let sales = await saleRepository.getAll();

    // Apply filters
    if (status) sales = sales.filter(s => s.status === status.toUpperCase());
    if (saleType) sales = sales.filter(s => s.saleType === saleType.toUpperCase());
    if (clientId) sales = sales.filter(s => s.clientId === clientId);

    // Sort by newest first
    sales.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    // Enrich with client name for display
    const enriched = await Promise.all(sales.map(async (sale) => {
      let clientName = null;
      if (sale.clientId) {
        try {
          const c = await clientRepository.getOne(sale.clientId);
          clientName = c ? c.name : null;
        } catch (_) {}
      }
      return { ...sale, clientName };
    }));

    return response(200, { items: enriched, total: enriched.length });
  } catch (error) {
    console.error('Error in getAllSales:', error);
    return response(500, { error: error.message });
  }
};
