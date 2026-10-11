'use strict';

const saleRepository = require('../shared/saleRepository');

const TIMEOUT_MINUTES = parseInt(process.env.PAYMENT_TIMEOUT_MINUTES || '120', 10);

/** Tarea programada: cancela los pedidos de la tienda que no se pagaron a tiempo y devuelve su stock. */
module.exports.handler = async () => {
  const cutoff = new Date(Date.now() - TIMEOUT_MINUTES * 60 * 1000).toISOString();
  const pending = await saleRepository.getPendingPaymentBefore(cutoff);

  let cancelled = 0;
  for (const sale of pending) {
    try {
      await saleRepository.changeFulfillment(sale.saleId, {
        to: 'CANCELLED',
        note: `Pago no recibido en ${TIMEOUT_MINUTES} minutos`,
        actor: 'sistema'
      });
      cancelled += 1;
    } catch (error) {
      console.error(`No se pudo cancelar ${sale.saleId}:`, error.message);
    }
  }

  console.log(`expirePendingPayments: ${cancelled}/${pending.length} cancelados`);
  return { cancelled, found: pending.length };
};
