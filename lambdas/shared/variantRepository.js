'use strict';

const crypto = require('crypto');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { loadAttributeIndex, normalizeVariantAttributes } = require('./catalogRules');
const {
  runTransaction,
  putVariant,
  deleteVariant,
  lockSku,
  unlockSku,
  initialInventoryRow,
  putInventoryRow,
  deleteInventoryRow,
  VARIANTS_TABLE
} = require('./catalogTransaction');
const { INVENTORY_TABLE } = require('./inventoryKeys');

const client = new DynamoDBClient({
  region: process.env.AWS_REGION || 'us-east-1'
});

const docClient = DynamoDBDocumentClient.from(client);

class VariantRepository {
  async create(variantData, locationId) {
    const [variant] = await this.createMany([variantData], locationId);
    return variant;
  }

  async createMany(variantsData, locationId) {
    const now = new Date().toISOString();

    const variants = variantsData.map((v) => ({
      variantId: 'var_' + crypto.randomBytes(12).toString('hex'),
      productId: v.productId,
      sku: v.sku,
      price: v.price,
      attributes: v.attributes,
      images: v.images || [],
      createdAt: now,
      updatedAt: now
    }));

    await runTransaction(
      variants.flatMap((v, i) => [
        putVariant(v),
        lockSku(v.sku, v.variantId),
        ...(locationId ? [putInventoryRow(initialInventoryRow(v, locationId, variantsData[i].stock || 0))] : [])
      ])
    );

    return variants.map((v, i) => ({ ...v, stock: variantsData[i].stock || 0, availableStock: variantsData[i].stock || 0 }));
  }

  async getAll() {
    const [result, index, stockMap] = await Promise.all([
      docClient.send(new ScanCommand({ TableName: VARIANTS_TABLE })),
      loadAttributeIndex(),
      this.#stockMap()
    ]);
    return (result.Items || []).map((v) => this.#present(v, index, stockMap));
  }

  async getOne(variantId) {
    const [variant, index, stockMap] = await Promise.all([
      this.#fetch(variantId),
      loadAttributeIndex(),
      this.#stockMap()
    ]);
    return variant ? this.#present(variant, index, stockMap) : null;
  }

  async getByProductId(productId) {
    const [result, index, stockMap] = await Promise.all([
      docClient.send(new ScanCommand({
        TableName: VARIANTS_TABLE,
        FilterExpression: 'productId = :productId',
        ExpressionAttributeValues: { ':productId': productId }
      })),
      loadAttributeIndex(),
      this.#stockMap()
    ]);
    return (result.Items || []).map((v) => this.#present(v, index, stockMap));
  }

  async stockOf(variantId) {
    const rows = await this.#inventoryRows(variantId);
    return rows.reduce((sum, r) => sum + (r.quantity || 0), 0);
  }

  async update(variantId, updates) {
    const current = await this.#fetch(variantId);
    if (!current) return null;

    const { expression, names, values } = this.#buildUpdate(updates);
    if (!expression) return this.getOne(variantId);

    if (updates.sku !== undefined && updates.sku !== current.sku) {
      await runTransaction([
        lockSku(updates.sku, variantId),
        unlockSku(current.sku),
        {
          Update: {
            TableName: VARIANTS_TABLE,
            Key: { variantId },
            UpdateExpression: expression,
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: values
          }
        }
      ]);
    } else {
      await docClient.send(new UpdateCommand({
        TableName: VARIANTS_TABLE,
        Key: { variantId },
        UpdateExpression: expression,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values
      }));
    }

    return this.getOne(variantId);
  }

  async delete(variantId) {
    const current = await this.#fetch(variantId);
    if (!current) return false;

    const rows = await this.#inventoryRows(variantId);
    await runTransaction([
      deleteVariant(variantId),
      unlockSku(current.sku),
      ...rows.map((r) => deleteInventoryRow(r.id))
    ]);
    return true;
  }

  async #fetch(variantId) {
    const result = await docClient.send(new GetCommand({
      TableName: VARIANTS_TABLE,
      Key: { variantId }
    }));
    return result.Item || null;
  }

  async #inventoryRows(variantId) {
    const result = await docClient.send(new ScanCommand({
      TableName: INVENTORY_TABLE,
      FilterExpression: 'variantId = :variantId',
      ExpressionAttributeValues: { ':variantId': variantId }
    }));
    return result.Items || [];
  }

  async #stockMap() {
    const result = await docClient.send(new ScanCommand({ TableName: INVENTORY_TABLE }));
    const map = new Map();
    for (const row of result.Items || []) {
      if (!row.variantId) continue;
      const current = map.get(row.variantId) || { stock: 0, availableStock: 0 };
      current.stock += row.quantity || 0;
      current.availableStock += row.availableQuantity ?? row.quantity ?? 0;
      map.set(row.variantId, current);
    }
    return map;
  }

  #present(variant, index, stockMap) {
    const stock = stockMap.get(variant.variantId) || { stock: 0, availableStock: 0 };
    const attributes = normalizeVariantAttributes(variant.attributes, index).map((a) => ({
      ...a,
      name: a.name ?? index.byId.get(a.attributeId)?.name ?? null
    }));
    return { ...variant, attributes, stock: stock.stock, availableStock: stock.availableStock };
  }

  #buildUpdate(updates) {
    const sets = [];
    const names = {};
    const values = {};

    Object.entries(updates).forEach(([key, value]) => {
      if (key === 'variantId' || key === 'stock' || value === undefined) return;
      sets.push(`#${key} = :${key}`);
      names[`#${key}`] = key;
      values[`:${key}`] = value;
    });

    if (sets.length === 0) return { expression: null };

    sets.push('#updatedAt = :updatedAt');
    names['#updatedAt'] = 'updatedAt';
    values[':updatedAt'] = new Date().toISOString();

    return { expression: `SET ${sets.join(', ')}`, names, values };
  }
}

module.exports = new VariantRepository();
