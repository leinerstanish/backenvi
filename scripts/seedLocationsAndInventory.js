const fs = require('fs');
if (fs.existsSync('.env')) {
  const envContent = fs.readFileSync('.env', 'utf-8');
  envContent.split('\n').forEach(line => {
    const eq = line.indexOf('=');
    if (eq > 0) {
      const k = line.slice(0, eq).trim();
      const v = line.slice(eq + 1).trim();
      if (!process.env[k]) process.env[k] = v;
    }
  });
}

const locationRepository = require('../lambdas/shared/locationRepository');
const inventoryRepository = require('../lambdas/shared/inventoryRepository');
const productRepository = require('../lambdas/shared/productRepository');

async function seed() {
  try {
    console.log('--- 1. Inicializando Bodega Principal ---');
    const defaultLocation = await locationRepository.getDefault();
    console.log('✅ Ubicación lista:', defaultLocation.locationId, '-', defaultLocation.name);

    console.log('\n--- 2. Obteniendo productos existentes ---');
    const products = await productRepository.getAll();
    console.log(`Encontrados ${products.length} productos.`);

    for (const prod of products) {
      const existing = await inventoryRepository.getByProductAndWarehouse(prod.productId, defaultLocation.locationId);
      if (!existing) {
        const item = await inventoryRepository.create({
          productId: prod.productId,
          warehouseId: defaultLocation.locationId,
          quantity: 25, // Stock inicial de prueba
          reorderLevel: 5,
          notes: 'Carga inicial de inventario'
        });
        console.log(`✅ Inventario creado para ${prod.name} (${prod.productId}): ${item.quantity} unidades (ID: ${item.id})`);
      } else {
        console.log(`ℹ️ Inventario ya existe para ${prod.name}: ${existing.quantity} unidades (ID: ${existing.id})`);
      }
    }

    console.log('\n--- 3. Verificando listado de inventario ---');
    const allInventory = await inventoryRepository.getAll();
    console.log(`Total items de inventario: ${allInventory.length}`);
    allInventory.forEach(inv => {
      console.log(`- [${inv.id}] Producto: ${inv.product?.name || inv.productId} | Stock: ${inv.quantity} | Disponible: ${inv.availableQuantity} | Bodega: ${inv.warehouse?.name}`);
    });

    console.log('\n✅ Seed de inventario y ubicaciones completado con éxito!');
  } catch (error) {
    console.error('Error durante el seed:', error);
    process.exit(1);
  }
}

seed();
