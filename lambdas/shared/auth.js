'use strict';

const jwt = require('jsonwebtoken');

const INTERNAL_PRODUCT_FIELDS = ['cost', 'supplierUrl', 'supplierLeadTimeDays', 'internalNotes'];

function isAdminRequest(event) {
  const header = event.headers?.Authorization || event.headers?.authorization || '';
  if (!header.startsWith('Bearer ') || !process.env.JWT_SECRET) return false;
  try {
    jwt.verify(header.slice(7), process.env.JWT_SECRET);
    return true;
  } catch {
    return false;
  }
}

function actorOf(event) {
  const header = event.headers?.Authorization || event.headers?.authorization || '';
  if (!header.startsWith('Bearer ')) return 'anónimo';
  const payload = jwt.decode(header.slice(7));
  return payload?.email || payload?.userId || 'anónimo';
}

function toPublicProduct(product) {
  const copy = { ...product };
  INTERNAL_PRODUCT_FIELDS.forEach((field) => delete copy[field]);
  return copy;
}

function presentProduct(event, product) {
  return isAdminRequest(event) ? product : toPublicProduct(product);
}

module.exports = { isAdminRequest, actorOf, presentProduct, INTERNAL_PRODUCT_FIELDS };
