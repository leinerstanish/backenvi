'use strict';

const SHIPPING_FEE = 9900;
const FREE_SHIPPING_FROM = 300000;

function calculateShippingFee(subtotal) {
  return subtotal > FREE_SHIPPING_FROM ? 0 : SHIPPING_FEE;
}

module.exports = { SHIPPING_FEE, FREE_SHIPPING_FROM, calculateShippingFee };
