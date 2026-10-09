'use strict';

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
const { HttpError } = require('./catalogRules');
const { INVENTORY_TABLE, inventoryIdFor } = require('./inventoryKeys');

const client = new DynamoDBClient({
  region: process.env.AWS_REGION || 'us-east-1'
});

const docClient = DynamoDBDocumentClient.from(client);

const PRODUCTS_TABLE = 'products_table';
const VARIANTS_TABLE = 'variants_table';
const SKU_LOCKS_TABLE = 'sku_locks_table';

const putProduct = (item) => ({
  Put: { TableName: PRODUCTS_TABLE, Item: item, ConditionExpression: 'attribute_not_exists(productId)' }
});

const putVariant = (item) => ({
  Put: { TableName: VARIANTS_TABLE, Item: item }
});

const deleteVariant = (variantId) => ({
  Delete: { TableName: VARIANTS_TABLE, Key: { variantId } }
});

const lockSku = (sku, variantId) => ({
  Put: { TableName: SKU_LOCKS_TABLE, Item: { sku, variantId }, ConditionExpression: 'attribute_not_exists(sku)' }
});

const unlockSku = (sku) => ({
  Delete: { TableName: SKU_LOCKS_TABLE, Key: { sku } }
});

const initialInventoryRow = (variant, locationId, quantity) => {
  const now = new Date().toISOString();
  return {
    id: inventoryIdFor(variant.variantId, locationId),
    productId: variant.productId,
    variantId: variant.variantId,
    warehouseId: locationId,
    quantity,
    reservedQuantity: 0,
    availableQuantity: quantity,
    reorderLevel: 10,
    lastRestockDate: quantity > 0 ? now : null,
    createdAt: now,
    updatedAt: now
  };
};

const putInventoryRow = (row) => ({
  Put: { TableName: INVENTORY_TABLE, Item: row, ConditionExpression: 'attribute_not_exists(id)' }
});

const deleteInventoryRow = (id) => ({
  Delete: { TableName: INVENTORY_TABLE, Key: { id } }
});

async function runTransaction(items) {
  try {
    await docClient.send(new TransactWriteCommand({ TransactItems: items }));
  } catch (error) {
    const reasons = error.CancellationReasons || [];
    if (error.name === 'TransactionCanceledException' && reasons.some((r) => r.Code === 'ConditionalCheckFailed')) {
      throw new HttpError(409, 'Ya existe una variante con ese SKU');
    }
    throw error;
  }
}

module.exports = {
  runTransaction,
  putProduct,
  putVariant,
  deleteVariant,
  lockSku,
  unlockSku,
  initialInventoryRow,
  putInventoryRow,
  deleteInventoryRow,
  VARIANTS_TABLE,
  SKU_LOCKS_TABLE,
};
