'use strict';

const productRepository = require('../shared/productRepository');
const variantRepository = require('../shared/variantRepository');
const s3Service = require('../shared/s3Service');
const { presentProduct } = require('../shared/auth');
const { HttpError } = require('../shared/catalogRules');
const { validateComponents } = require('../shared/comboRules');

const CORS_HEADERS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Credentials': true };
const response = (statusCode, body) => ({ statusCode, headers: CORS_HEADERS, body: JSON.stringify(body) });

const EDITABLE_FIELDS = ['name', 'description', 'categoryId', 'brandId'];

module.exports.handler = async (event) => {
  try {
    const { productId } = event.pathParameters || {};
    const body = JSON.parse(event.body || '{}');

    const existing = await productRepository.getOne(productId);
    if (!existing) throw new HttpError(404, 'Combo no encontrado');
    if (existing.kind !== 'COMBO') throw new HttpError(400, 'El producto no es un combo');

    const updates = {};
    EDITABLE_FIELDS.forEach((f) => { if (body[f] !== undefined) updates[f] = body[f]; });
    if (body.images !== undefined) {
      updates.images = await s3Service.processImages(body.images || [], 'products');
    }

    if (body.components !== undefined) {
      const newComponents = validateComponents(body.components);
      const currentIds = (existing.comboComponents || []).map((c) => c.productId).sort().join(',');
      const nextIds = newComponents.map((c) => c.productId).sort().join(',');
      if (currentIds !== nextIds) {
        throw new HttpError(400, 'Para cambiar los productos del combo, crea un combo nuevo. Aquí solo puedes cambiar precios');
      }

      const priceOf = new Map(newComponents.map((c) => [c.productId, c.price]));
      updates.comboComponents = newComponents;

      const comboVariants = await variantRepository.getByProductId(productId);
      for (const v of comboVariants) {
        const selection = v.comboSelection.map((s) => ({ ...s, price: priceOf.get(s.productId) }));
        const price = selection.reduce((sum, s) => sum + s.price, 0);
        await variantRepository.update(v.variantId, { price, comboSelection: selection });
      }
    }

    await productRepository.update(productId, updates);
    const product = await productRepository.getOne(productId);
    const variants = await variantRepository.getByProductId(productId);

    return response(200, presentProduct(event, { ...product, variants }));
  } catch (error) {
    if (error instanceof HttpError) {
      return response(error.statusCode, { error: error.message, message: error.message });
    }
    console.error('Error in updateCombo:', error);
    return response(500, { error: error.message, message: error.message });
  }
};
