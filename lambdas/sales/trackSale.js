'use strict';

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

const NOT_FOUND = { error: 'No encontramos un pedido con esos datos. Revisa el número y el correo o teléfono de compra.' };

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();
const normalizePhone = (value) => String(value || '').replace(/\D/g, '');

// El teléfono se compara por los últimos 10 dígitos para ignorar el indicativo de país.
const samePhone = (a, b) => {
  const x = normalizePhone(a);
  const y = normalizePhone(b);
  if (x.length < 7 || y.length < 7) return false;
  return x.slice(-10) === y.slice(-10);
};

// Solo los eventos que el cliente debe ver. "by" y las compras a proveedor son internos.
const publicTimeline = (timeline = []) => timeline
  .filter((event) => event.type === 'CREATED' || event.type === 'FULFILLMENT')
  .map((event) => ({
    type: event.type,
    status: event.type === 'FULFILLMENT' ? event.to : 'PENDING',
    note: event.note || '',
    at: event.at
  }));

module.exports.handler = async (event) => {
  try {
    const { saleId, email, phone } = JSON.parse(event.body || '{}');
    if (!saleId || (!email && !phone)) {
      return response(400, { error: 'Indica el número de pedido y el correo o teléfono con que compraste.' });
    }

    const sale = await saleRepository.getOne(String(saleId).trim());
    if (!sale || !sale.clientId) return response(404, NOT_FOUND);

    const client = await clientRepository.getOne(sale.clientId).catch(() => null);
    if (!client) return response(404, NOT_FOUND);

    const emailMatches = email && normalizeEmail(client.email) === normalizeEmail(email);
    const phoneMatches = phone && samePhone(client.phone, phone);
    if (!emailMatches && !phoneMatches) return response(404, NOT_FOUND);

    const firstName = String(client.name || '').trim().split(/\s+/)[0] || '';

    return response(200, {
      saleId: sale.saleId,
      receiptNumber: sale.receiptNumber || null,
      createdAt: sale.createdAt,
      customerFirstName: firstName,
      saleType: sale.saleType,
      paymentStatus: sale.status,
      fulfillmentStatus: sale.fulfillmentStatus || 'PENDING',
      items: (sale.items || []).map((item) => ({
        name: item.name,
        quantity: item.quantity,
        price: item.price,
        subtotal: item.subtotal,
        fulfillment: item.fulfillment || 'STOCK',
        fulfillmentStatus: item.fulfillmentStatus || null
      })),
      subtotal: sale.subtotal,
      shippingFee: sale.shippingFee || 0,
      totalAmount: sale.totalAmount,
      balanceDue: sale.balanceDue || 0,
      timeline: publicTimeline(sale.timeline)
    });
  } catch (error) {
    console.error('Error in trackSale:', error);
    return response(500, { error: 'No pudimos consultar tu pedido. Intenta de nuevo.' });
  }
};
