'use strict';

const saleRepository = require('../shared/saleRepository');
const clientRepository = require('../shared/clientRepository');
const { fetchTransaction, saleIdFromReference } = require('../shared/wompi');
const { applyWompiTransaction } = require('../shared/onlinePayment');

const CORS_HEADERS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Credentials': true };
const response = (statusCode, body) => ({ statusCode, headers: CORS_HEADERS, body: JSON.stringify(body) });

/**
 * Estado del pago para la página de resultado. Si llega el id de transacción que Wompi pone en la
 * URL de retorno, se consulta en Wompi y se aplica: así el pedido se aprueba aunque el webhook tarde.
 */
module.exports.handler = async (event) => {
  try {
    const { saleId } = event.pathParameters || {};
    const transactionId = event.queryStringParameters?.id;

    let sale = saleId && (await saleRepository.getOne(saleId));
    if (!sale || sale.channel !== 'STORE') return response(404, { error: 'Pedido no encontrado' });

    if (transactionId && sale.status === 'PENDING_PAYMENT') {
      const tx = await fetchTransaction(transactionId).catch((error) => {
        console.error('Wompi fetchTransaction failed:', error.message);
        return null;
      });
      if (tx && saleIdFromReference(tx.reference) === saleId) {
        await applyWompiTransaction(tx);
        sale = await saleRepository.getOne(saleId);
      }
    }

    const client = sale.clientId ? await clientRepository.getOne(sale.clientId).catch(() => null) : null;
    const attempt = sale.lastPaymentAttempt;

    return response(200, {
      saleId: sale.saleId,
      paymentStatus: sale.status,
      fulfillmentStatus: sale.fulfillmentStatus || 'PENDING',
      receiptNumber: sale.receiptNumber || null,
      customerFirstName: String(client?.name || '').trim().split(/\s+/)[0] || '',
      lastAttempt: attempt ? { transactionId: attempt.transactionId, status: attempt.status, method: attempt.method, at: attempt.at } : null,
      paidWith: sale.onlinePayment?.method || null,
      items: (sale.items || []).map((item) => ({
        name: item.name,
        quantity: item.quantity,
        price: item.price,
        subtotal: item.subtotal
      })),
      subtotal: sale.subtotal,
      shippingFee: sale.shippingFee || 0,
      totalAmount: sale.totalAmount,
      createdAt: sale.createdAt
    });
  } catch (error) {
    console.error('Error in getCheckoutStatus:', error);
    return response(500, { error: 'No pudimos consultar el pago. Intenta de nuevo.' });
  }
};
