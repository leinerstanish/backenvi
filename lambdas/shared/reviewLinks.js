'use strict';

const saleRepository = require('./saleRepository');

async function findLineByToken(token) {
  const saleId = String(token || '').split('.')[0];
  if (!saleId || !saleId.startsWith('sale_')) return null;

  const sale = await saleRepository.getOne(saleId);
  if (!sale) return null;

  const lineIndex = (sale.items || []).findIndex((i) => i.reviewToken === token);
  if (lineIndex < 0) return null;

  return { sale, lineIndex, line: sale.items[lineIndex] };
}

module.exports = { findLineByToken };
