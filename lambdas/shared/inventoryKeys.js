'use strict';

const INVENTORY_TABLE = 'inventory_table';
const MOVEMENTS_TABLE = 'inventory_movements_table';

const inventoryIdFor = (variantId, locationId) => `inv_${variantId}_${locationId}`;

module.exports = { INVENTORY_TABLE, MOVEMENTS_TABLE, inventoryIdFor };
