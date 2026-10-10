'use strict';

const productRepository = require('../shared/productRepository');
const variantRepository = require('../shared/variantRepository');
const s3Service = require('../shared/s3Service');
const { presentProduct, isAdminRequest } = require('../shared/auth');
const { HttpError, FULFILLMENT } = require('../shared/catalogRules');
const { validateComponents, buildComboVariants } = require('../shared/comboRules');

const CORS_HEADERS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Credentials': true };
const response = (statusCode, body) => ({ statusCode, headers: CORS_HEADERS, body: JSON.stringify(body) });

module.exports.handler = async (event) => {
  try {
    if (!isAdminRequest(event)) {
      return response(401, { error: 'Sesión de administrador requerida' });
    }

    const { name, description, categoryId, brandId, images, components } = JSON.parse(event.body || '{}');
    if (!name) throw new HttpError(400, 'name requerido');

    const validComponents = validateComponents(components);

    const variantsByProduct = new Map();
    for (const c of validComponents) {
      const product = await productRepository.getOne(c.productId);
      if (!product) throw new HttpError(400, `Producto no existe: ${c.productId}`);
      if (product.kind === 'COMBO') throw new HttpError(400, 'Un combo no puede contener otro combo');
      if ((product.fulfillment || FULFILLMENT.STOCK) !== FULFILLMENT.STOCK) {
        throw new HttpError(400, `${product.name} es externo: los combos solo admiten productos con inventario propio`);
      }
      const variants = (await variantRepository.getByProductId(c.productId)).filter((v) => v.kind !== 'COMBO');
      if (variants.length === 0) throw new HttpError(400, `${product.name} no tiene variantes`);
      variantsByProduct.set(c.productId, variants);
    }

    const comboVariants = buildComboVariants(validComponents, variantsByProduct, null);
    const uploadedImages = await s3Service.processImages(images || [], 'products');

    const product = await productRepository.createCombo({
      name,
      description: description || '',
      categoryId: categoryId || null,
      brandId: brandId || null,
      images: uploadedImages,
      components: validComponents
    }, comboVariants);

    const variants = await variantRepository.getByProductId(product.productId);
    return response(201, presentProduct(event, { ...product, variants }));
  } catch (error) {
    if (error instanceof HttpError) {
      return response(error.statusCode, { error: error.message, message: error.message });
    }
    console.error('Error in createCombo:', error);
    return response(500, { error: error.message, message: error.message });
  }
};
