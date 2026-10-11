'use strict';

const crypto = require('crypto');
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

const samePhone = (a, b) => {
  const x = normalizePhone(a);
  const y = normalizePhone(b);
  if (x.length < 7 || y.length < 7) return false;
  return x.slice(-10) === y.slice(-10);
};

const publicTimeline = (timeline = []) => (timeline || [])
  .filter((event) => event.type === 'CREATED' || event.type === 'FULFILLMENT')
  .map((event) => ({
    type: event.type,
    status: event.type === 'FULFILLMENT' ? event.to : 'PENDING',
    note: event.note || '',
    at: event.at
  }));

const ensureReviewTokens = async (sale) => {
  if (sale.fulfillmentStatus !== 'DELIVERED' || !Array.isArray(sale.items)) return sale;
  let changed = false;
  const items = sale.items.map((item) => {
    if (!item.reviewToken) {
      changed = true;
      return {
        ...item,
        reviewToken: `${sale.saleId}.${crypto.randomBytes(16).toString('hex')}`
      };
    }
    return item;
  });

  if (changed) {
    sale.items = items;
    await saleRepository.update(sale.saleId, { items }).catch((err) => {
      console.warn('Could not auto-persist reviewTokens on sale:', err.message);
    });
  }
  return sale;
};

const formatTrackedOrder = (sale, client) => {
  const firstName = String(client?.name || sale?.clientName || '').trim().split(/\s+/)[0] || '';
  return {
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
      fulfillmentStatus: item.fulfillmentStatus || null,
      productId: item.productId || null,
      variantId: item.variantId || null,
      reviewToken: item.reviewToken || null
    })),
    subtotal: sale.subtotal,
    shippingFee: sale.shippingFee || 0,
    totalAmount: sale.totalAmount,
    balanceDue: sale.balanceDue || 0,
    timeline: publicTimeline(sale.timeline)
  };
};

module.exports.handler = async (event) => {
  try {
    const { saleId, email, phone } = JSON.parse(event.body || '{}');
    const cleanSaleId = String(saleId || '').trim();
    const cleanEmail = normalizeEmail(email);
    const cleanPhone = normalizePhone(phone);

    if (!cleanSaleId && !cleanEmail && !cleanPhone) {
      return response(400, { error: 'Ingresa el número de pedido o el correo/teléfono de compra.' });
    }

    // CASO 1: Se proporcionó el número de pedido (o recibo)
    if (cleanSaleId) {
      let sale = await saleRepository.getOne(cleanSaleId);
      if (!sale) {
        const all = await saleRepository.getAll().catch(() => []);
        sale = all.find(s => s.receiptNumber && s.receiptNumber.toLowerCase() === cleanSaleId.toLowerCase());
      }

      if (!sale) return response(404, NOT_FOUND);

      let client = null;
      if (sale.clientId) {
        client = await clientRepository.getOne(sale.clientId).catch(() => null);
      }

      if (cleanEmail || cleanPhone) {
        const emailMatches = cleanEmail && client && normalizeEmail(client.email) === cleanEmail;
        const phoneMatches = cleanPhone && client && samePhone(client.phone, cleanPhone);
        if (!emailMatches && !phoneMatches) {
          return response(404, { error: 'El pedido no coincide con el correo o teléfono ingresado.' });
        }
      }

      await ensureReviewTokens(sale);
      const formatted = formatTrackedOrder(sale, client);
      return response(200, {
        ...formatted,
        orders: [formatted]
      });
    }

    // CASO 2: Se proporcionó únicamente correo o teléfono -> Listar todas las compras
    const clients = await clientRepository.getAll().catch(() => []);
    const matchingClients = clients.filter((c) => {
      const emailMatches = cleanEmail && normalizeEmail(c.email) === cleanEmail;
      const phoneMatches = cleanPhone && samePhone(c.phone, cleanPhone);
      return emailMatches || phoneMatches;
    });

    if (matchingClients.length === 0) {
      return response(404, { error: 'No encontramos compras asociadas a ese correo o teléfono.' });
    }

    const clientMap = new Map();
    matchingClients.forEach((c) => clientMap.set(c.clientId, c));

    const allSales = await saleRepository.getAll().catch(() => []);
    const userSales = allSales.filter((s) => s.clientId && clientMap.has(s.clientId));

    if (userSales.length === 0) {
      return response(404, { error: 'No encontramos pedidos asociados a este cliente.' });
    }

    userSales.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());

    for (const s of userSales) {
      await ensureReviewTokens(s);
    }

    const trackedOrders = userSales.map((sale) => formatTrackedOrder(sale, clientMap.get(sale.clientId)));
    const primaryClient = matchingClients[0];
    const firstName = String(primaryClient.name || '').trim().split(/\s+/)[0] || '';

    return response(200, {
      customerFirstName: firstName,
      orders: trackedOrders,
      ...(trackedOrders.length === 1 ? trackedOrders[0] : {})
    });
  } catch (error) {
    console.error('Error in trackSale:', error);
    return response(500, { error: 'No pudimos consultar tu pedido. Intenta de nuevo.' });
  }
};
