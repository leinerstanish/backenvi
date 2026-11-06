'use strict';

/**
 * Importa las esencias del catálogo de perfumería como productos ENVI, con una variante por tamaño.
 *
 *   node scripts/importPerfumes.js esencias.json precios.json            → solo muestra qué haría
 *   node scripts/importPerfumes.js esencias.json precios.json --apply    → crea lo que falte
 *
 * esencias.json: lista de { codigo, fragancia, disenador, genero, familias[], descripcion_olfativa, revisar }
 * precios.json:
 *   {
 *     "gramosPorTamano": { "30": 9, "50": 15, "100": 30 },   // gramos de esencia por frasco
 *     "precioGramo": 2000,                                    // precio del gramo por defecto
 *     "precioGramoPorCodigo": { "336": 2500 },                // opcional: precio distinto por código
 *     "margen": 0.25,                                         // ganancia sobre el precio de venta
 *     "fulfillment": "EXTERNAL"                               // EXTERNAL (bajo pedido) o STOCK (bodega)
 *   }
 *
 * Precio = costo ÷ (1 − margen), redondeado hacia arriba a un valor terminado en 900.
 * Es seguro repetirlo: las esencias ya importadas (mismo código y fragancia) se saltan.
 * Las que tienen el código repetido en el catálogo se saltan hasta que se confirme su código.
 */

require('dotenv').config();
const fs = require('fs');
const productRepository = require('../lambdas/shared/productRepository');
const categoryRepository = require('../lambdas/shared/categoryRepository');
const attributeRepository = require('../lambdas/shared/attributeRepository');
const brandRepository = require('../lambdas/shared/brandRepository');
const locationRepository = require('../lambdas/shared/locationRepository');
const { validatePerfume, FULFILLMENT } = require('../lambdas/shared/catalogRules');

const [essencesPath, pricesPath] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const apply = process.argv.includes('--apply');
if (!essencesPath || !pricesPath) {
  console.error('Uso: node scripts/importPerfumes.js esencias.json precios.json [--apply]');
  process.exit(1);
}

const SIZES = ['30', '50', '100'];
const SIZE_VALUE = (ml) => `${ml} ml`;
const HOUSE_BRAND = 'ENVI';

/** Redondea hacia arriba al siguiente valor terminado en 900 (53.333 → 53.900). */
const roundTo900 = (value) => Math.max(900, Math.ceil((value - 900) / 1000) * 1000 + 900);

function pricing(config, code) {
  const perGram = Number(config.precioGramoPorCodigo?.[code] ?? config.precioGramo);
  if (!Number.isFinite(perGram) || perGram <= 0) throw new Error(`Sin precio del gramo para el código ${code}`);
  const margin = Number(config.margen ?? 0.25);
  return SIZES.map((ml) => {
    const grams = Number(config.gramosPorTamano?.[ml]);
    if (!Number.isFinite(grams) || grams <= 0) throw new Error(`Faltan los gramos de esencia para ${ml} ml`);
    const cost = Math.round(grams * perGram);
    return { ml, grams, cost, price: roundTo900(cost / (1 - margin)) };
  });
}

const description = (e) =>
  `${e.descripcion_olfativa ? `${e.descripcion_olfativa}. ` : ''}Perfume preparado por ENVI con esencia inspirada en ${e.fragancia} de ${e.disenador}. ` +
  `Disponible en 30, 50 y 100 ml. ENVI no está afiliada a ${e.disenador}: su nombre se usa solo como referencia del aroma.`;

async function ensureCategory(name, parentId) {
  const all = await categoryRepository.getAll();
  const found = all.find((c) => c.name.toLowerCase() === name.toLowerCase() && (c.parentId || null) === (parentId || null));
  if (found) return { category: found, created: false };
  if (!apply) return { category: { categoryId: `(nueva: ${name})`, name }, created: true };
  return { category: await categoryRepository.create({ name, parentId, description: '' }), created: true };
}

async function ensureSizeAttribute() {
  const all = await attributeRepository.getAll();
  const wanted = SIZES.map(SIZE_VALUE);
  const found = all.find((a) => a.name.toLowerCase() === 'tamaño');
  if (!found) {
    if (!apply) return { attribute: { attributeId: '(nuevo: Tamaño)', name: 'Tamaño' }, note: 'se creará el atributo Tamaño' };
    return { attribute: await attributeRepository.create({ name: 'Tamaño', type: 'TEXT', values: wanted, isRequired: false, isPublished: true }), note: 'atributo Tamaño creado' };
  }
  const missing = wanted.filter((v) => !(found.values || []).includes(v));
  if (missing.length && apply) await attributeRepository.update(found.attributeId, { values: [...(found.values || []), ...missing] });
  return { attribute: found, note: missing.length ? `se agregan valores: ${missing.join(', ')}` : 'atributo Tamaño ya existe' };
}

(async () => {
  const essences = JSON.parse(fs.readFileSync(essencesPath, 'utf8'));
  const config = JSON.parse(fs.readFileSync(pricesPath, 'utf8'));
  const fulfillment = config.fulfillment === FULFILLMENT.STOCK ? FULFILLMENT.STOCK : FULFILLMENT.EXTERNAL;

  // ── Estructura: Perfumería → Esencias, atributo Tamaño y marca ENVI ──
  const root = await ensureCategory('Perfumería', null);
  const child = await ensureCategory('Esencias', root.created && !apply ? null : root.category.categoryId);
  const size = await ensureSizeAttribute();
  const brand = (await brandRepository.getAll()).find((b) => b.name.toUpperCase() === HOUSE_BRAND);
  if (!brand) throw new Error('No existe la marca ENVI');
  const location = fulfillment === FULFILLMENT.STOCK ? await locationRepository.getDefault() : null;
  console.log(`Categoría: Perfumería ${root.created ? '(se crea)' : '✓'} → Esencias ${child.created ? '(se crea)' : '✓'}`);
  console.log(`Atributo: ${size.note} · Marca: ${brand.name} · Inventario: ${fulfillment === 'STOCK' ? 'en bodega' : 'bajo pedido'}`);

  // ── Precios de ejemplo ──
  const sample = pricing(config, String(essences[0].codigo));
  console.log('\nPrecio por tamaño (precio del gramo por defecto):');
  for (const s of sample) console.log(`  ${s.ml} ml: ${s.grams} g × $${Number(config.precioGramo).toLocaleString('es-CO')} = costo $${s.cost.toLocaleString('es-CO')} → precio $${s.price.toLocaleString('es-CO')}`);

  // ── Qué falta importar ──
  const existing = (await productRepository.getAll()).filter((p) => p.perfume);
  const already = new Set(existing.map((p) => `${p.perfume.supplierCode}|${p.perfume.inspiredBy.fragrance.toLowerCase()}`));
  const codes = essences.reduce((m, e) => m.set(e.codigo, (m.get(e.codigo) || 0) + 1), new Map());
  const todo = [];
  const skipped = [];
  for (const e of essences) {
    if (codes.get(e.codigo) > 1) skipped.push(`${e.codigo} ${e.fragancia} — código repetido en el catálogo`);
    else if (already.has(`${e.codigo}|${e.fragancia.toLowerCase()}`)) continue;
    else todo.push(e);
  }
  console.log(`\nYa importadas: ${existing.length} · Por importar: ${todo.length} · Se saltan: ${skipped.length}`);
  skipped.forEach((s) => console.log(`  · ${s}`));
  if (!apply) {
    console.log('\nEjemplos:');
    todo.slice(0, 3).forEach((e) => console.log(`  Inspirado en ${e.fragancia} – ${e.disenador}: ${pricing(config, String(e.codigo)).map((s) => `${s.ml} ml $${s.price.toLocaleString('es-CO')}`).join(' · ')}`));
    console.log('\nNo se escribió nada. Ejecuta con --apply para importar.');
    return;
  }

  let created = 0;
  for (const e of todo) {
    const code = String(e.codigo);
    const sizes = pricing(config, code);
    const perfume = validatePerfume({
      inspiredBy: { designer: e.disenador, fragrance: e.fragancia },
      gender: e.genero || 'Unisex',
      families: e.familias,
      description: e.descripcion_olfativa,
      supplierCode: code,
    });
    await productRepository.createWithVariants(
      {
        name: `Inspirado en ${e.fragancia} – ${e.disenador}`,
        description: description(e),
        categoryId: child.category.categoryId,
        brandId: brand.brandId,
        images: [],
        sku: `ESN-${code}`,
        price: sizes[0].price,
        cost: sizes[0].cost,
        fulfillment,
        internalNotes: `Esencia JJ Quimienvases código ${code}. Costos: ${sizes.map((s) => `${s.ml} ml $${s.cost}`).join(', ')}.`,
        perfume,
      },
      sizes.map((s) => ({
        sku: `ESN-${code}-${s.ml}`,
        price: s.price,
        stock: 0,
        attributes: [{ attributeId: size.attribute.attributeId, value: SIZE_VALUE(s.ml) }],
        images: [],
      })),
      location ? location.locationId : null,
    );
    created++;
    if (created % 25 === 0) console.log(`  ${created} de ${todo.length}…`);
  }
  console.log(`\nListo: ${created} esencias importadas.`);
})().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
