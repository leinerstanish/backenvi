'use strict';

const STORE_URL = (process.env.STORE_URL || 'https://envitienda.com').replace(/\/$/, '');

// Wompi agrega "?id=<transacción>" a esta URL al terminar el pago.
const checkoutRedirectUrl = (saleId) => `${STORE_URL}/checkout/pago/${saleId}`;

module.exports = { checkoutRedirectUrl };
