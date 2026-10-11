'use strict';

const { isValidEvent } = require('../shared/wompi');
const { applyWompiTransaction } = require('../shared/onlinePayment');

const response = (statusCode, body) => ({ statusCode, body: JSON.stringify(body) });

/**
 * Webhook de Wompi (URL de eventos). Wompi reintenta mientras no reciba 200, así que solo se
 * responde error cuando el procesamiento falla y vale la pena que lo vuelva a enviar.
 */
module.exports.handler = async (event) => {
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return response(400, { error: 'JSON inválido' });
  }

  if (!isValidEvent(body)) {
    console.warn('Wompi: evento con firma inválida descartado');
    return response(401, { error: 'Firma inválida' });
  }

  if (body.event !== 'transaction.updated' || !body.data?.transaction) {
    return response(200, { ignored: body.event });
  }

  try {
    const result = await applyWompiTransaction(body.data.transaction);
    console.log('Wompi event', body.data.transaction.id, result);
    return response(200, result);
  } catch (error) {
    console.error('Error processing Wompi event:', error);
    return response(500, { error: 'Error procesando el evento' });
  }
};
