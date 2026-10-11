'use strict';

const saleRepository = require('../shared/saleRepository');
const clientRepository = require('../shared/clientRepository');
const variantRepository = require('../shared/variantRepository');
const productRepository = require('../shared/productRepository');
const locationRepository = require('../shared/locationRepository');
const { HttpError, FULFILLMENT, loadAttributeIndex, normalizeVariantAttributes } = require('../shared/catalogRules');
const { checkoutSession } = require('../shared/wompi');
const { checkoutRedirectUrl } = require('./checkoutLinks');

const CORS_HEADERS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Credentials': true };
const response = (statusCode, body) => ({ statusCode, headers: CORS_HEADERS, body: JSON.stringify(body) });

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validCustomer(customer = {}) {
  const name = String(customer.name || '').trim();
  const email = String(customer.email || '').trim().toLowerCase();
  const phone = String(customer.phone || '').trim();
  const address = String(customer.address || '').trim();
  if (!name) throw new HttpError(400, 'Indica tu nombre');
  if (!EMAIL_PATTERN.test(email)) throw new HttpError(400, 'Indica un correo válido');
  if (phone.replace(/\D/g, '').length < 7) throw new HttpError(400, 'Indica un teléfono válido');
  if (!address) throw new HttpError(400, 'Indica la dirección de envío');
  return { name, email, phone, address, documentId: String(customer.documentId || '').trim() };
}

/**
 * Checkout público de la tienda. Los precios salen del catálogo (nunca del navegador), el stock queda
 * reservado y la venta espera en PENDING_PAYMENT hasta que Wompi confirme el pago.
 */
module.exports.handler = async (event) => {
  try {
    const { customer, items } = JSON.parse(event.body || '{}');
    if (!Array.isArray(items) || items.length === 0) {
      throw new HttpError(400, 'El carrito está vacío');
    }
    const buyer = validCustomer(customer);

    const defaultLocationId = (await locationRepository.getDefault()).locationId;
    const index = await loadAttributeIndex();

    const saleItems = [];
    for (const item of items) {
      const quantity = parseInt(item.quantity, 10);
      if (!item.productId || !item.variantId || !Number.isInteger(quantity) || quantity <= 0) {
        throw new HttpError(400, 'Hay un producto inválido en el carrito');
      }

      const variant = await variantRepository.getOne(item.variantId);
      if (!variant || variant.productId !== item.productId) {
        throw new HttpError(400, 'Uno de los productos del carrito ya no está disponible');
      }
      const product = await productRepository.getOne(item.productId);
      if (!product) throw new HttpError(400, 'Uno de los productos del carrito ya no está disponible');

      const price = Number(variant.price);
      if (!(price > 0)) throw new HttpError(400, `${product.name} no tiene precio configurado`);

      if (variant.kind === 'COMBO') {
        saleItems.push({
          productId: item.productId,
          variantId: variant.variantId,
          sku: variant.sku,
          attributes: normalizeVariantAttributes(variant.attributes, index),
          fulfillment: FULFILLMENT.STOCK,
          kind: 'COMBO',
          components: variant.comboSelection,
          locationId: defaultLocationId,
          name: product.name,
          price,
          quantity
        });
        continue;
      }

      const fulfillment = product.fulfillment || FULFILLMENT.STOCK;
      saleItems.push({
        productId: item.productId,
        variantId: variant.variantId,
        sku: variant.sku,
        attributes: normalizeVariantAttributes(variant.attributes, index),
        fulfillment,
        locationId: fulfillment === FULFILLMENT.EXTERNAL ? null : defaultLocationId,
        name: product.name,
        price,
        quantity
      });
    }

    const client = await clientRepository.create(buyer);
    const { sale } = await saleRepository.create({
      actor: buyer.email,
      clientId: client.clientId,
      items: saleItems,
      saleType: 'CASH',
      paymentMethod: 'WOMPI',
      channel: 'STORE',
      awaitingPayment: true,
      notes: ''
    });

    return response(201, {
      saleId: sale.saleId,
      subtotal: sale.subtotal,
      shippingFee: sale.shippingFee,
      totalAmount: sale.totalAmount,
      wompi: checkoutSession({
        saleId: sale.saleId,
        amount: sale.totalAmount,
        redirectUrl: checkoutRedirectUrl(sale.saleId),
        customer: buyer
      })
    });
  } catch (error) {
    if (error.statusCode) return response(error.statusCode, { error: error.message, message: error.message });
    console.error('Error in createCheckout:', error);
    return response(500, { error: 'No pudimos iniciar el pago. Intenta de nuevo.' });
  }
};
