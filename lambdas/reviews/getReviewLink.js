'use strict';

const { findLineByToken } = require('../shared/reviewLinks');
const reviewRepository = require('../shared/reviewRepository');
const productRepository = require('../shared/productRepository');
const variantRepository = require('../shared/variantRepository');

const CORS_HEADERS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Credentials': true };
const response = (statusCode, body) => ({ statusCode, headers: CORS_HEADERS, body: JSON.stringify(body) });

module.exports.handler = async (event) => {
  try {
    const { token } = event.pathParameters || {};
    const found = await findLineByToken(token);
    if (!found) {
      return response(404, { error: 'Enlace de reseña no válido' });
    }

    const { sale, lineIndex, line } = found;
    if (sale.fulfillmentStatus !== 'DELIVERED') {
      return response(409, { error: 'Este pedido aún no ha sido entregado' });
    }

    const [product, variant, existing] = await Promise.all([
      line.productId ? productRepository.getOne(line.productId).catch(() => null) : null,
      line.variantId ? variantRepository.getOne(line.variantId).catch(() => null) : null,
      reviewRepository.getOne(`${sale.saleId}#${lineIndex}`).catch(() => null)
    ]);

    return response(200, {
      productId: line.productId || (product ? product.productId : ''),
      productName: product ? product.name : line.name,
      productImage: product && product.images && product.images[0] ? product.images[0] : null,
      variantLabel: variant ? (variant.attributes || []).map((a) => a.name ? `${a.name}: ${a.value}` : a.value).join(' · ') : '',
      alreadyReviewed: Boolean(existing)
    });
  } catch (error) {
    console.error('Error in getReviewLink:', error);
    return response(500, { error: error.message });
  }
};
