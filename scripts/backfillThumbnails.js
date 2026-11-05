'use strict';

/**
 * Crea las miniaturas WebP y los recortes sin fondo (tienda virtual) de las fotos que ya existían.
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
const { buildThumbnails, buildCutouts, allProductImages, virtualStorePhotos, keyOf } = require('../lambdas/shared/productImages');

const apply = process.argv.includes('--apply');

(async () => {
  const products = await productRepository.getAll();
  let pendingTotal = 0;
  let updated = 0;

  for (const product of products) {
    const urls = [...new Set(allProductImages(product))];
    const previous = product.thumbnails || {};
    const pending = urls.filter((url) => !previous[url] && keyOf(url));
    const cutoutUrls = [...new Set(virtualStorePhotos(product))];
    const previousCutouts = product.cutouts || {};
    const pendingCutouts = cutoutUrls.filter((url) => !(url in previousCutouts) && keyOf(url));
    if (pending.length === 0 && pendingCutouts.length === 0) continue;
    pendingTotal += pending.length + pendingCutouts.length;

    if (!apply) {
      console.log(`· ${product.name}: ${pending.length} miniatura(s) y ${pendingCutouts.length} recorte(s) por crear`);
      continue;
    }

    const thumbnails = await buildThumbnails(urls, previous);
    const cutouts = await buildCutouts(cutoutUrls, previousCutouts);
    const created = Object.keys(thumbnails).filter((url) => !previous[url]).length;
    const cut = Object.entries(cutouts).filter(([url, value]) => value && !previousCutouts[url]).length;
    await productRepository.update(product.productId, { thumbnails, cutouts });
    updated++;
    console.log(`✓ ${product.name}: ${created} miniatura(s) nuevas · ${cut} de ${pendingCutouts.length} foto(s) recortadas`);
  }

  console.log(
    apply
      ? `\nListo: ${updated} producto(s) actualizados.`
      : `\n${pendingTotal} miniatura(s)/recorte(s) por crear en ${products.length} producto(s). Ejecuta con --apply para crearlos.`
  );
})().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
