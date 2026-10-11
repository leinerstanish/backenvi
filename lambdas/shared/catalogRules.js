'use strict';

const attributeRepository = require('./attributeRepository');

const MAX_VARIANTS_PER_PRODUCT = 30;

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

const normalizeName = (name) => String(name || '').trim().toLowerCase();

async function loadAttributeIndex() {
  const attributes = await attributeRepository.getAll();
  return {
    byId: new Map(attributes.map((a) => [a.attributeId, a])),
    byName: new Map(attributes.map((a) => [normalizeName(a.name), a])),
  };
}

function normalizeVariantAttributes(raw, index) {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== 'object') return [];

  return Object.entries(raw).map(([name, value]) => {
    const attribute = index.byName.get(normalizeName(name));
    return attribute
      ? { attributeId: attribute.attributeId, value: String(value) }
      : { attributeId: null, name, value: String(value) };
  });
}

function validateAttributes(list, index) {
  if (!Array.isArray(list) || list.length === 0) {
    throw new HttpError(400, 'Cada variante requiere al menos un atributo: [{ attributeId, value }]');
  }

  const seen = new Set();
  return list.map((item) => {
    const attribute = index.byId.get(item?.attributeId);
    if (!attribute) {
      throw new HttpError(400, `attributeId no existe: ${item?.attributeId}`);
    }
    if (seen.has(attribute.attributeId)) {
      throw new HttpError(400, `Atributo repetido en la variante: ${attribute.name}`);
    }
    seen.add(attribute.attributeId);

    const value = String(item.value ?? '').trim();
    if (!value) {
      throw new HttpError(400, `Falta el valor para ${attribute.name}`);
    }

    const allowed = (attribute.values || []).map(String);
    if (allowed.length && !allowed.includes(value)) {
      throw new HttpError(400, `Valor "${value}" no permitido para ${attribute.name}`);
    }

    return { attributeId: attribute.attributeId, value };
  });
}

function validateVariant(input, index) {
  const sku = String(input?.sku ?? '').trim();
  if (!sku) {
    throw new HttpError(400, 'Cada variante requiere sku');
  }

  const price = Number(input.price);
  if (!Number.isFinite(price) || price < 0) {
    throw new HttpError(400, `Precio inválido para el SKU ${sku}`);
  }

  const stock = input.stock === undefined ? 0 : Number(input.stock);
  if (!Number.isInteger(stock) || stock < 0) {
    throw new HttpError(400, `Stock inválido para el SKU ${sku}`);
  }

  return {
    sku,
    price,
    stock,
    attributes: validateAttributes(input.attributes, index),
    images: Array.isArray(input.images) ? input.images : [],
  };
}

function validateVariantSet(inputs, index) {
  if (!Array.isArray(inputs) || inputs.length === 0) {
    throw new HttpError(400, 'El producto debe tener al menos una variante');
  }
  if (inputs.length > MAX_VARIANTS_PER_PRODUCT) {
    throw new HttpError(400, `Máximo ${MAX_VARIANTS_PER_PRODUCT} variantes por solicitud`);
  }

  const validated = inputs.map((input) => validateVariant(input, index));

  const seenSkus = new Set();
  for (const variant of validated) {
    if (seenSkus.has(variant.sku)) {
      throw new HttpError(409, `SKU duplicado en la solicitud: ${variant.sku}`);
    }
    seenSkus.add(variant.sku);
  }

  return validated;
}

const FULFILLMENT = { STOCK: 'STOCK', EXTERNAL: 'EXTERNAL' };

function validateProductExtras(input) {
  const out = {};

  if (input.fulfillment !== undefined) {
    if (!Object.values(FULFILLMENT).includes(input.fulfillment)) {
      throw new HttpError(400, 'fulfillment debe ser STOCK o EXTERNAL');
    }
    out.fulfillment = input.fulfillment;
  }

  if (input.supplierUrl !== undefined) {
    const url = String(input.supplierUrl || '').trim();
    if (url && !/^https:\/\/\S+$/.test(url)) {
      throw new HttpError(400, 'supplierUrl debe comenzar con https://');
    }
    out.supplierUrl = url;
  }

  if (input.supplierLeadTimeDays !== undefined) {
    const days = input.supplierLeadTimeDays === null || input.supplierLeadTimeDays === ''
      ? null
      : Number(input.supplierLeadTimeDays);
    if (days !== null && (!Number.isInteger(days) || days < 0)) {
      throw new HttpError(400, 'supplierLeadTimeDays debe ser un entero mayor o igual a 0');
    }
    out.supplierLeadTimeDays = days;
  }

  if (input.internalNotes !== undefined) {
    out.internalNotes = String(input.internalNotes || '');
  }

  if (input.sizeGuide !== undefined) {
    out.sizeGuide = validateSizeGuide(input.sizeGuide);
  }

  return out;
}

// Guía de tallas por producto. Es visible para el cliente, así que no es un campo interno.
// null borra la guía.
const GARMENT_TYPES = ['shirt', 'hoodie', 'pants', 'sweater', 'jacket', 'shorts'];
const SIZE_GUIDE_MEASURES = ['chest', 'waist', 'hips', 'length', 'shoulder', 'sleeve', 'inseam', 'thigh', 'rise'];
const MAX_SIZE_GUIDE_ROWS = 30;

function validateSizeGuide(input) {
  if (input === null) return null;
  if (!input || typeof input !== 'object') {
    throw new HttpError(400, 'sizeGuide debe ser un objeto { garmentType, measurements } o null');
  }
  if (!GARMENT_TYPES.includes(input.garmentType)) {
    throw new HttpError(400, `garmentType debe ser uno de: ${GARMENT_TYPES.join(', ')}`);
  }
  if (!Array.isArray(input.measurements) || input.measurements.length === 0) {
    throw new HttpError(400, 'sizeGuide.measurements debe tener al menos una talla');
  }
  if (input.measurements.length > MAX_SIZE_GUIDE_ROWS) {
    throw new HttpError(400, `sizeGuide admite máximo ${MAX_SIZE_GUIDE_ROWS} tallas`);
  }

  const measurements = input.measurements.map((row) => {
    const sizeName = String(row?.sizeName ?? '').trim();
    if (!sizeName) {
      throw new HttpError(400, 'Cada talla de la guía requiere sizeName');
    }
    const clean = { sizeName };
    SIZE_GUIDE_MEASURES.forEach((field) => {
      const raw = row[field];
      if (raw === undefined || raw === null || raw === '') return;
      const value = Number(raw);
      if (!Number.isFinite(value) || value < 0) {
        throw new HttpError(400, `Medida inválida "${field}" para la talla ${sizeName}`);
      }
      clean[field] = value;
    });
    return clean;
  });

  return {
    garmentType: input.garmentType,
    measurements,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Estado que ve la tienda: lo que el admin haya guardado (INACTIVE, ARCHIVED) manda;
 * si no, un producto sin variantes no se puede vender todavía.
 */
function productStatus(product, variantCount) {
  if (product.status && product.status !== 'ACTIVE') return product.status;
  return variantCount > 0 ? 'ACTIVE' : 'PENDING_VARIANTS';
}

module.exports = {
  HttpError,
  FULFILLMENT,
  productStatus,
  loadAttributeIndex,
  normalizeVariantAttributes,
  validateVariant,
  validateVariantSet,
  validateProductExtras,
};
