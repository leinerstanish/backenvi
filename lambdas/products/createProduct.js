'use strict';

const productRepository = require('../shared/productRepository');
const s3Service = require('../shared/s3Service');
const locationRepository = require('../shared/locationRepository');
const { validateProductVideos } = require('../shared/productVideos');
const { validateProductModel } = require('../shared/productModel3d');
const { validateChannelImages, buildThumbnails, buildCutouts, allProductImages, virtualStorePhotos } = require('../shared/productImages');
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

module.exports.handler = async (event) => {
  try {
    const body = JSON.parse(event.body || '{}');
    const { name, description, categoryId, brandId, images, sku, price, cost, variants } = body;

    if (!name) {
      return response(400, { error: 'Name required', message: 'Name required' });
    }

    const extras = validateProductExtras(body);
    const videos = validateProductVideos(body.videos);
    const channelImages = validateChannelImages(body);
    const model3d = validateProductModel(body.model3d);
    const fulfillment = extras.fulfillment || FULFILLMENT.STOCK;

    const index = await loadAttributeIndex();
    const validVariants = validateVariantSet(variants, index);

    if (fulfillment === FULFILLMENT.EXTERNAL && validVariants.some((v) => v.stock > 0)) {
      throw new HttpError(400, 'Un producto externo no maneja inventario: el stock de sus variantes debe ser 0');
    }

    const uploadedImages = await s3Service.processImages(images || [], 'products');
    // Fotos propias del lookbook y de la tienda virtual (vacías = usar las de la tienda)
    const lookbookImages = await s3Service.processImages(channelImages.lookbookImages || [], 'products');
    const virtualStoreImages = await s3Service.processImages(channelImages.virtualStoreImages || [], 'products');
    const thumbnails = await buildThumbnails(allProductImages({ images: uploadedImages, lookbookImages, virtualStoreImages }));
    // Recortes sin fondo de las fotos que muestra la tienda virtual
    const cutouts = await buildCutouts(virtualStorePhotos({ images: uploadedImages, virtualStoreImages }));
    const variantsWithImages = await Promise.all(
      validVariants.map(async (v) => ({
        ...v,
        images: await s3Service.processImages(v.images, 'variants')
      }))
    );

    const location = fulfillment === FULFILLMENT.STOCK ? await locationRepository.getDefault() : null;

    const product = await productRepository.createWithVariants({
      name,
      description: description || '',
      categoryId: categoryId || null,
      brandId: brandId || null,
      images: uploadedImages,
      lookbookImages,
      virtualStoreImages,
      thumbnails,
      cutouts,
      ...(model3d ? { model3d } : {}),
      ...(videos ? { videos } : {}),
      sku: sku || '',
      price: price || 0,
      cost: cost || 0,
      ...extras,
      fulfillment
    }, variantsWithImages, location ? location.locationId : null);

    return response(201, product);
  } catch (error) {
    if (error.statusCode) {
      return response(error.statusCode, { error: error.message, message: error.message });
    }
    console.error('Error:', error);
    return response(500, { error: error.message, message: error.message });
  }
};
