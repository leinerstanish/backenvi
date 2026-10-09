'use strict';

const saleRepository = require('../shared/saleRepository');
const { isAdminRequest, actorOf } = require('../shared/auth');
const { HttpError } = require('../shared/catalogRules');
const { notifyStatusChanged, notifyReviewInvitation } = require('../shared/emailService');

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
    if (!isAdminRequest(event)) {
      return response(401, { error: 'Sesión de administrador requerida' });
    }

    const { saleId } = event.pathParameters || {};
    const { status, note } = JSON.parse(event.body || '{}');

    if (!status) {
      return response(400, { error: 'status requerido' });
    }

    const sale = await saleRepository.changeFulfillment(saleId, {
      to: status,
      note,
      actor: actorOf(event)
    });

    if (!sale) {
      return response(404, { error: 'Venta no encontrada' });
    }

    try {
      await notifyStatusChanged(saleId, status, note);
      if (status === 'DELIVERED') {
        await notifyReviewInvitation(saleId);
      }
    } catch (emailError) {
      console.error('Status email failed (status kept):', emailError.message);
    }

    return response(200, sale);
  } catch (error) {
    if (error instanceof HttpError) {
      return response(error.statusCode, { error: error.message });
    }
    console.error('Error in updateSaleStatus:', error);
    return response(500, { error: error.message });
  }
};
