'use strict';

const productRepository = require('../shared/productRepository');
const variantRepository = require('../shared/variantRepository');
const inventoryRepository = require('../shared/inventoryRepository');
const s3Service = require('../shared/s3Service');
const locationRepository = require('../shared/locationRepository');
const { validateProductVideos } = require('../shared/productVideos');
const { presentProduct } = require('../shared/auth');
const { loadAttributeIndex, validateVariantSet, validateProductExtras, FULFILLMENT, HttpError } = require('../shared/catalogRules');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Credentials': true,
};

const response = (statusCode, body) => ({
  statusCode,
  headers: CORS_HEADERS,
  body: JSON.stringify(body)
});

const EDITABLE_FIELDS = ['name', 'description', 'price', 'cost', 'categoryId', 'brandId', 'images', 'attributes', 'sku', 'status'];

module.exports.handler = async (event) => {
  try {
    const { productId } = event.pathParameters || {};
    const { variants, ...body } = JSON.parse(event.body || '{}');

    const existing = await productRepository.getOne(productId);
    if (!existing) {
      return response(404, { error: 'Product not found' });
    }

    const extras = validateProductExtras(body);
    const productUpdates = {};
    EDITABLE_FIELDS.forEach((field) => {
      if (body[field] !== undefined) productUpdates[field] = body[field];
    });
    Object.assign(productUpdates, extras);

    // Solo se tocan los videos si la petición los trae; sin el campo, quedan como estaban.
    const videos = validateProductVideos(body.videos);
    if (videos !== undefined) productUpdates.videos = videos;

    const currentFulfillment = existing.fulfillment || FULFILLMENT.STOCK;
    const nextFulfillment = extras.fulfillment || currentFulfillment;
    const existingVariants = await variantRepository.getByProductId(productId);

    if (nextFulfillment !== currentFulfillment) {
      if (nextFulfillment === FULFILLMENT.EXTERNAL) {
        for (const v of existingVariants) {
          if ((await variantRepository.stockOf(v.variantId)) > 0) {
            throw new HttpError(409, 'Ajusta el stock de las variantes a 0 antes de convertir el producto en externo');
          }
        }
      } else {
        const location = await locationRepository.getDefault();
        for (const v of existingVariants) {
          await inventoryRepository.setVariantStock(v, 0, location.locationId);
        }
      }
    }

    if (productUpdates.images !== undefined) {
      productUpdates.images = await s3Service.processImages(productUpdates.images || [], 'products');
    }

    if (variants !== undefined) {
      const index = await loadAttributeIndex();
      const validVariants = validateVariantSet(variants, index);

      if (nextFulfillment === FULFILLMENT.EXTERNAL && validVariants.some((v) => v.stock > 0)) {
        throw new HttpError(400, 'Un producto externo no maneja inventario: el stock de sus variantes debe ser 0');
      }

      const variantsWithImages = await Promise.all(
        validVariants.map(async (v) => ({
          ...v,
          productId,
          images: await s3Service.processImages(v.images, 'variants')
        }))
      );

      const location = nextFulfillment === FULFILLMENT.STOCK ? await locationRepository.getDefault() : null;
      await variantRepository.createMany(variantsWithImages, location ? location.locationId : null);
    }

    const product = await productRepository.update(productId, productUpdates);
    const allVariants = await variantRepository.getByProductId(productId);

    return response(200, presentProduct(event, { ...product, variants: allVariants }));
  } catch (error) {
    if (error.statusCode) {
      return response(error.statusCode, { error: error.message, message: error.message });
    }
    console.error('Error:', error);
    return response(500, { error: error.message });
  }
};
