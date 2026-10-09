'use strict';

const saleRepository = require('../shared/saleRepository');
const { isAdminRequest, actorOf } = require('../shared/auth');
const { HttpError } = require('../shared/catalogRules');

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

    const { saleId, index } = event.pathParameters || {};
    const lineIndex = Number(index);
    if (!Number.isInteger(lineIndex) || lineIndex < 0) {
      return response(400, { error: 'Índice de línea inválido' });
    }

    const sale = await saleRepository.markLinePurchased(saleId, lineIndex, { actor: actorOf(event) });

    if (!sale) {
      return response(404, { error: 'Venta no encontrada' });
    }

    return response(200, sale);
  } catch (error) {
    if (error instanceof HttpError) {
      return response(error.statusCode, { error: error.message });
    }
    console.error('Error in markLinePurchased:', error);
    return response(500, { error: error.message });
  }
};
