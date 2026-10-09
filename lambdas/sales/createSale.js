'use strict';

const saleRepository = require('../shared/saleRepository');
const variantRepository = require('../shared/variantRepository');
const productRepository = require('../shared/productRepository');
const locationRepository = require('../shared/locationRepository');
const { HttpError, FULFILLMENT, loadAttributeIndex, normalizeVariantAttributes } = require('../shared/catalogRules');
const { actorOf } = require('../shared/auth');
const { generateReceipt } = require('../shared/receiptService');
const { notifyOrderConfirmed } = require('../shared/emailService');

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
    const body = JSON.parse(event.body || '{}');

    const {
      clientId,
      items,
      locationId,
      saleType,
      initialPayment,
      paymentMethod,
      dueDate,
      notes
    } = body;

    if (!items || items.length === 0) {
      return response(400, { error: 'La venta debe tener al menos un producto' });
    }

    const defaultLocationId = locationId || (await locationRepository.getDefault()).locationId;
    const index = await loadAttributeIndex();

    const enrichedItems = [];
    for (const item of items) {
      if (!item.productId || !item.variantId) {
        throw new HttpError(400, 'Cada línea de venta requiere productId y variantId');
      }
      const quantity = parseInt(item.quantity, 10);
      if (!Number.isInteger(quantity) || quantity <= 0) {
        throw new HttpError(400, `Cantidad inválida para la variante ${item.variantId}`);
      }

      const variant = await variantRepository.getOne(item.variantId);
      if (!variant || variant.productId !== item.productId) {
        throw new HttpError(400, `La variante ${item.variantId} no pertenece al producto ${item.productId}`);
      }

      const product = await productRepository.getOne(item.productId);
      const fulfillment = product?.fulfillment || FULFILLMENT.STOCK;

      enrichedItems.push({
        productId: item.productId,
        variantId: variant.variantId,
        sku: variant.sku,
        attributes: normalizeVariantAttributes(variant.attributes, index),
        fulfillment,
        locationId: fulfillment === FULFILLMENT.EXTERNAL ? null : (item.locationId || defaultLocationId),
        name: item.name,
        price: item.price,
        quantity
      });
    }

    const result = await saleRepository.create({
      actor: actorOf(event),
      clientId,
      items: enrichedItems,
      saleType: saleType || 'CASH',
      initialPayment: initialPayment || 0,
      paymentMethod: paymentMethod || 'CASH',
      dueDate: dueDate || null,
      notes: notes || ''
    });

    try {
      await generateReceipt(result.sale.saleId);
    } catch (receiptError) {
      console.error('Receipt generation failed (sale kept):', receiptError);
    }

    try {
      await notifyOrderConfirmed(result.sale.saleId);
    } catch (emailError) {
      console.error('Order confirmation email failed (sale kept):', emailError.message);
    }

    return response(201, result);
  } catch (error) {
    if (error.statusCode) {
      return response(error.statusCode, { error: error.message, message: error.message });
    }
    console.error('Error in createSale:', error);
    return response(500, { error: error.message });
  }
};
