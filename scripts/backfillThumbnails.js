'use strict';

/**
 * Crea las miniaturas WebP de las fotos de productos que ya existían antes de esta función.
 *
 *   node scripts/backfillThumbnails.js           → solo muestra qué haría (no escribe nada)
 *   node scripts/backfillThumbnails.js --apply   → crea las miniaturas en S3 y guarda el campo
 *                                                 `thumbnails` en cada producto
 *
 * Es seguro repetirlo: reutiliza las miniaturas que ya existen y solo agrega las que falten.
 * No cambia ninguna otra información del producto.
 */

require('dotenv').config();
const productRepository = require('../lambdas/shared/productRepository');
const { buildThumbnails, allProductImages, keyOf } = require('../lambdas/shared/productImages');

const apply = process.argv.includes('--apply');

(async () => {
  const products = await productRepository.getAll();
  let pendingTotal = 0;
  let updated = 0;

  for (const product of products) {
    const urls = [...new Set(allProductImages(product))];
    const previous = product.thumbnails || {};
    const pending = urls.filter((url) => !previous[url] && keyOf(url));
    if (pending.length === 0) continue;
    pendingTotal += pending.length;

    if (!apply) {
      console.log(`· ${product.name}: ${pending.length} miniatura(s) por crear`);
      continue;
    }

    const thumbnails = await buildThumbnails(urls, previous);
    const created = Object.keys(thumbnails).filter((url) => !previous[url]).length;
    await productRepository.update(product.productId, { thumbnails });
    updated++;
    console.log(`✓ ${product.name}: ${created} de ${pending.length} miniatura(s) creadas`);
  }

  console.log(
    apply
      ? `\nListo: ${updated} producto(s) actualizados.`
      : `\n${pendingTotal} miniatura(s) por crear en ${products.length} producto(s). Ejecuta con --apply para crearlas.`
  );
})().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
