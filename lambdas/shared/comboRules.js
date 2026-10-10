'use strict';

const crypto = require('crypto');
const { HttpError } = require('./catalogRules');

const MAX_COMBO_VARIANTS = 40;
const MAX_COMPONENTS = 6;

function validateComponents(components) {
  if (!Array.isArray(components) || components.length < 2) {
    throw new HttpError(400, 'Un combo necesita al menos 2 productos');
  }
  if (components.length > MAX_COMPONENTS) {
    throw new HttpError(400, `Un combo admite máximo ${MAX_COMPONENTS} productos`);
  }
  const seen = new Set();
  return components.map((c) => {
    if (!c || !c.productId) throw new HttpError(400, 'Cada componente requiere productId');
    if (seen.has(c.productId)) throw new HttpError(400, 'Un producto no puede repetirse en el combo');
    seen.add(c.productId);
    const price = Number(c.price);
    if (!Number.isFinite(price) || price < 0) throw new HttpError(400, `Precio inválido para ${c.productId}`);
    return { productId: c.productId, price };
  });
}

function cartesian(lists) {
  return lists.reduce((acc, list) => acc.flatMap((combo) => list.map((item) => [...combo, item])), [[]]);
}

function buildComboVariants(components, variantsByProduct, comboProductId) {
  const lists = components.map((c) => variantsByProduct.get(c.productId) || []);
  if (lists.some((list) => list.length === 0)) {
    throw new HttpError(400, 'Todos los productos del combo deben tener al menos una variante');
  }

  const combinations = cartesian(lists);
  if (combinations.length > MAX_COMBO_VARIANTS) {
    throw new HttpError(400, `El combo generaría ${combinations.length} variantes; el máximo es ${MAX_COMBO_VARIANTS}. Reduce las variantes de los productos`);
  }

  const now = new Date().toISOString();
  return combinations.map((combo) => {
    const selection = combo.map((v, i) => ({
      productId: v.productId,
      variantId: v.variantId,
      sku: v.sku,
      price: components[i].price
    }));
    return {
      variantId: 'var_' + crypto.randomBytes(12).toString('hex'),
      productId: comboProductId,
      kind: 'COMBO',
      sku: combo.map((v) => v.sku).join('+'),
      price: selection.reduce((sum, s) => sum + s.price, 0),
      attributes: combo.flatMap((v) => v.attributes || []),
      comboSelection: selection,
      images: [],
      createdAt: now,
      updatedAt: now
    };
  });
}

function flattenStockLines(items) {
  return items.flatMap((item) => {
    if (item.kind === 'COMBO') {
      return (item.components || []).map((c) => ({
        productId: c.productId,
        variantId: c.variantId,
        sku: c.sku,
        quantity: item.quantity,
        locationId: item.locationId
      }));
    }
    if (item.fulfillment === 'EXTERNAL' || !item.variantId || !item.locationId) return [];
    return [{
      productId: item.productId,
      variantId: item.variantId,
      sku: item.sku,
      quantity: item.quantity,
      locationId: item.locationId
    }];
  });
}

module.exports = { MAX_COMBO_VARIANTS, validateComponents, buildComboVariants, flattenStockLines };
