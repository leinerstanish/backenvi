'use strict';

const saleRepository = require('./saleRepository');
const paymentRepository = require('./paymentRepository');
const { generateReceipt } = require('./receiptService');
const { notifyOrderConfirmed } = require('./emailService');
const { CURRENCY, toCents, saleIdFromReference } = require('./wompi');

const PROVIDER = 'WOMPI';
const FINAL_FAILURES = ['DECLINED', 'VOIDED', 'ERROR'];

/**
 * Aplica a la venta el estado de una transacción de Wompi. Es idempotente: el webhook y la página
 * de resultado pueden llamarla con la misma transacción sin duplicar pagos, comprobantes ni correos.
 */
async function applyWompiTransaction(tx) {
  const saleId = saleIdFromReference(tx?.reference);
  const sale = saleId && (await saleRepository.getOne(saleId));
  if (!sale) return { outcome: 'UNKNOWN_SALE', saleId };

  const attempt = {
    provider: PROVIDER,
    transactionId: tx.id,
    reference: tx.reference,
    status: tx.status,
    method: tx.payment_method_type || null,
    amountInCents: tx.amount_in_cents
  };

  if (tx.currency !== CURRENCY || Number(tx.amount_in_cents) !== toCents(sale.totalAmount)) {
    console.error(`Wompi: monto no coincide en ${saleId}`, { esperado: toCents(sale.totalAmount), recibido: tx.amount_in_cents, moneda: tx.currency });
    await saleRepository.recordPaymentAttempt(saleId, { ...attempt, status: 'AMOUNT_MISMATCH' });
    return { outcome: 'AMOUNT_MISMATCH', saleId };
  }

  if (tx.status === 'APPROVED') {
    const { applied } = await saleRepository.markPaidOnline(saleId, attempt);
    if (!applied) {
      const current = await saleRepository.getOne(saleId);
      if (current?.status === 'CANCELLED') {
        // El cliente pagó un pedido que ya se había cancelado (y su stock liberado): hay que reembolsar.
        console.error(`Wompi: pago aprobado para pedido cancelado ${saleId} (tx ${tx.id}), requiere reembolso`);
        await saleRepository.recordPaymentAttempt(saleId, { ...attempt, status: 'APPROVED_AFTER_CANCEL' });
        return { outcome: 'APPROVED_AFTER_CANCEL', saleId };
      }
      return { outcome: 'ALREADY_APPLIED', saleId };
    }

    await paymentRepository.create({
      saleId,
      clientId: sale.clientId,
      amount: sale.totalAmount,
      paymentMethod: `${PROVIDER}_${attempt.method || 'ONLINE'}`,
      notes: `Wompi ${tx.id} (${tx.reference})`
    });

    try {
      await generateReceipt(saleId);
    } catch (receiptError) {
      console.error('Receipt generation failed (payment kept):', receiptError);
    }
    try {
      await notifyOrderConfirmed(saleId);
    } catch (emailError) {
      console.error('Order confirmation email failed (payment kept):', emailError.message);
    }
    return { outcome: 'APPROVED', saleId };
  }

  if (FINAL_FAILURES.includes(tx.status)) {
    await saleRepository.recordPaymentAttempt(saleId, attempt);
    return { outcome: tx.status, saleId };
  }

  return { outcome: 'PENDING', saleId };
}

module.exports = { applyWompiTransaction, PROVIDER };
