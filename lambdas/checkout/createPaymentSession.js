'use strict';

const saleRepository = require('../shared/saleRepository');
const clientRepository = require('../shared/clientRepository');
const { checkoutSession } = require('../shared/wompi');
const { checkoutRedirectUrl } = require('./checkoutLinks');

const CORS_HEADERS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Credentials': true };
const response = (statusCode, body) => ({ statusCode, headers: CORS_HEADERS, body: JSON.stringify(body) });

/** Nueva sesión de pago para reintentar (pago rechazado o ventana cerrada) sobre el mismo pedido. */
module.exports.handler = async (event) => {
  try {
    const { saleId } = event.pathParameters || {};
    const sale = saleId && (await saleRepository.getOne(saleId));
    if (!sale || sale.channel !== 'STORE') return response(404, { error: 'Pedido no encontrado' });
    if (sale.status === 'PAID') return response(409, { error: 'Este pedido ya está pagado' });
    if (sale.status !== 'PENDING_PAYMENT') {
      return response(409, { error: 'Este pedido venció o fue cancelado. Vuelve a hacer tu compra.' });
    }

    const client = sale.clientId ? await clientRepository.getOne(sale.clientId).catch(() => null) : null;
    return response(200, {
      saleId,
      totalAmount: sale.totalAmount,
      wompi: checkoutSession({
        saleId,
        amount: sale.totalAmount,
        redirectUrl: checkoutRedirectUrl(saleId),
        customer: client
      })
    });
  } catch (error) {
    console.error('Error in createPaymentSession:', error);
    return response(500, { error: 'No pudimos preparar el pago. Intenta de nuevo.' });
  }
};
