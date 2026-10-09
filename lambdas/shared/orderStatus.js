'use strict';

const { HttpError } = require('./catalogRules');

const FULFILLMENT_STATUSES = ['PENDING', 'PREPARING', 'SHIPPED', 'DELIVERED', 'CANCELLED'];

const TRANSITIONS = {
  PENDING: ['PREPARING', 'CANCELLED'],
  PREPARING: ['SHIPPED', 'CANCELLED'],
  SHIPPED: ['DELIVERED'],
  DELIVERED: [],
  CANCELLED: []
};

function assertTransition(from, to) {
  if (!FULFILLMENT_STATUSES.includes(to)) {
    throw new HttpError(400, `Estado inválido: ${to}`);
  }
  if (!(TRANSITIONS[from] || []).includes(to)) {
    throw new HttpError(409, `No se puede pasar de ${from} a ${to}`);
  }
}

module.exports = { FULFILLMENT_STATUSES, assertTransition };
