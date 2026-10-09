'use strict';

const saleRepository = require('../shared/saleRepository');
const clientRepository = require('../shared/clientRepository');
const paymentRepository = require('../shared/paymentRepository');
const { generateReceipt, receiptUrl } = require('../shared/receiptService');

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

    const sale = await saleRepository.getOne(saleId);
    if (!sale) return response(404, { error: 'Venta no encontrada' });

    // Enrich with client info
    let clientInfo = null;
    if (sale.clientId) {
      clientInfo = await clientRepository.getOne(sale.clientId).catch(() => null);
    }

    // Get all payments for this sale
    const payments = await paymentRepository.getAll({ saleId });
    const totalPaid = payments.reduce((sum, p) => sum + (p.amount || 0), 0);

    let receipt = { receiptNumber: sale.receiptNumber || null, receiptKey: sale.receiptKey || null };
    if (!receipt.receiptKey) {
      try {
        receipt = { ...receipt, ...(await generateReceipt(saleId)) };
      } catch (receiptError) {
        console.error('Receipt generation failed:', receiptError);
      }
    }

    return response(200, {
      ...sale,
      receiptNumber: receipt.receiptNumber,
      receiptUrl: receipt.receiptKey ? await receiptUrl(receipt.receiptKey) : null,
      client: clientInfo,
      payments: payments.sort((a, b) => new Date(a.paymentDate) - new Date(b.paymentDate)),
      totalPaid,
    });
  } catch (error) {
    console.error('Error in getSale:', error);
    return response(500, { error: error.message });
  }
};
