'use strict';

const { findLineByToken } = require('../shared/reviewLinks');
const reviewRepository = require('../shared/reviewRepository');
const { HttpError } = require('../shared/catalogRules');

const CORS_HEADERS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Credentials': true };
const response = (statusCode, body) => ({ statusCode, headers: CORS_HEADERS, body: JSON.stringify(body) });

const MAX_PHOTOS = 5;

function ownBucketPrefix() {
  const bucket = process.env.AWS_S3_BUCKET || 'gnfls';
  const region = process.env.AWS_S3_REGION || 'us-east-2';
  return `https://${bucket}.s3.${region}.amazonaws.com/`;
}

function validateReview(body) {
  const rating = Number(body.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new HttpError(400, 'La calificación debe ser un entero de 1 a 5');
  }

  const comment = String(body.comment || '').trim();
  if (comment.length > 1000) {
    throw new HttpError(400, 'El comentario no puede pasar de 1000 caracteres');
  }

  const photos = Array.isArray(body.photos) ? body.photos : [];
  if (photos.length > MAX_PHOTOS) {
    throw new HttpError(400, `Máximo ${MAX_PHOTOS} fotos`);
  }
  const prefix = ownBucketPrefix();
  if (photos.some((url) => typeof url !== 'string' || !url.startsWith(prefix))) {
    throw new HttpError(400, 'Las fotos deben subirse a nuestro almacenamiento');
  }

  const customerName = String(body.customerName || '').trim().slice(0, 60);

  return { rating, comment, photos, customerName };
}

module.exports.handler = async (event) => {
  try {
    const body = JSON.parse(event.body || '{}');
    const review = validateReview(body);

    const found = await findLineByToken(body.token);
    if (!found) {
      return response(404, { error: 'Enlace de reseña no válido' });
    }

    const { sale, lineIndex, line } = found;
    if (sale.fulfillmentStatus !== 'DELIVERED') {
      return response(409, { error: 'Solo puedes reseñar pedidos entregados' });
    }

    try {
      const created = await reviewRepository.create({
        reviewId: `${sale.saleId}#${lineIndex}`,
        saleId: sale.saleId,
        lineIndex,
        productId: line.productId || null,
        variantId: line.variantId || null,
        ...review
      });
      return response(201, created);
    } catch (error) {
      if (error.name === 'ConditionalCheckFailedException') {
        return response(409, { error: 'Ya enviaste una reseña para este producto' });
      }
      throw error;
    }
  } catch (error) {
    if (error instanceof HttpError) {
      return response(error.statusCode, { error: error.message });
    }
    console.error('Error in createReview:', error);
    return response(500, { error: error.message });
  }
};
