'use strict';

const { sendTemplate, TEMPLATE_TYPES } = require('../shared/emailService');
const { isAdminRequest } = require('../shared/auth');
const { HttpError } = require('../shared/catalogRules');

const CORS_HEADERS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Credentials': true };
const response = (statusCode, body) => ({ statusCode, headers: CORS_HEADERS, body: JSON.stringify(body) });

module.exports.handler = async (event) => {
  try {
    if (!isAdminRequest(event)) {
      return response(401, { error: 'Sesión de administrador requerida' });
    }

    const { type, to, data } = JSON.parse(event.body || '{}');
    if (!to || !type) {
      return response(400, { error: 'type y to son requeridos', types: TEMPLATE_TYPES });
    }

    const info = await sendTemplate(type, to, data || {});
    return response(200, { sent: true, messageId: info.messageId });
  } catch (error) {
    if (error instanceof HttpError) {
      return response(error.statusCode, { error: error.message });
    }
    console.error('Error in sendEmail:', error);
    return response(500, { error: error.message });
  }
};
