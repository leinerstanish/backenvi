'use strict';

const saleRepository = require('../shared/saleRepository');
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
    const { saleId } = event.pathParameters || {};
    if (!saleId) return response(400, { error: 'saleId requerido' });

    const { amount, paymentMethod, notes, paymentDate } = JSON.parse(event.body || '{}');

    if (!amount || isNaN(amount) || parseFloat(amount) <= 0) {
      return response(400, { error: 'Monto de pago inválido' });
    }

    // Fetch the current sale to get clientId and check balance
    const sale = await saleRepository.getOne(saleId);
    if (!sale) return response(404, { error: 'Venta no encontrada' });

    if (sale.status === 'PAID') {
      return response(400, { error: 'Esta venta ya está completamente pagada' });
    }

    const paymentAmount = parseFloat(amount);

    // 1. Create the payment record
    const payment = await paymentRepository.create({
      saleId,
      clientId: sale.clientId || null,
      amount: paymentAmount,
      paymentMethod: paymentMethod || 'CASH',
      notes: notes || '',
      paymentDate: paymentDate || new Date().toISOString()
    });

    // 2. Update the sale's balance and status
    const updatedSale = await saleRepository.updateStatusAndBalance(saleId, paymentAmount);

    return response(201, {
      payment,
      sale: updatedSale,
      message: updatedSale.status === 'PAID'
        ? '¡Venta saldada completamente!'
        : `Pago registrado. Saldo pendiente: $${updatedSale.balanceDue.toLocaleString('es-CO')}`
    });
  } catch (error) {
    console.error('Error in createPayment:', error);
    return response(500, { error: error.message });
  }
};
