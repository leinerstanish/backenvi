'use strict';

const crypto = require('crypto');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, ScanCommand, GetCommand, UpdateCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');

const productRepository = require('./productRepository');
const locationRepository = require('./locationRepository');
const { inventoryIdFor } = require('./inventoryKeys');
const { loadAttributeIndex, normalizeVariantAttributes } = require('./catalogRules');

const client = new DynamoDBClient({
  region: process.env.AWS_REGION || 'us-east-1'
});

const docClient = DynamoDBDocumentClient.from(client);
const INVENTORY_TABLE = 'inventory_table';
const MOVEMENTS_TABLE = 'inventory_movements_table';

class InventoryRepository {
  async create(data) {
    const quantity = parseInt(data.quantity, 10) || 0;
    const reservedQuantity = parseInt(data.reservedQuantity, 10) || 0;
    const availableQuantity = Math.max(0, quantity - reservedQuantity);
    const reorderLevel = parseInt(data.reorderLevel, 10) || 10;

    let warehouseId = data.warehouseId || data.locationId;
    if (!warehouseId) {
      const defaultLoc = await locationRepository.getDefault();
      warehouseId = defaultLoc.locationId;
    }

    const id = data.variantId
      ? inventoryIdFor(data.variantId, warehouseId)
      : data.id || 'inv_' + crypto.randomBytes(12).toString('hex');

    const item = {
      id,
      productId: data.productId,
      variantId: data.variantId || null,
      warehouseId,
      quantity,
      reservedQuantity,
      availableQuantity,
      reorderLevel,
      lastRestockDate: quantity > 0 ? new Date().toISOString() : null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await docClient.send(new PutCommand({
      TableName: INVENTORY_TABLE,
      Item: item,
      ConditionExpression: 'attribute_not_exists(id)'
    }));

    if (quantity > 0) {
      await this._recordMovement({
        inventoryId: id,
        productId: item.productId,
        warehouseId: item.warehouseId,
        type: 'IN',
        reason: 'RESTOCK',
        quantity,
        previousQuantity: 0,
        newQuantity: quantity,
        notes: data.notes || 'Inventario inicial'
      });
    }

    return await this.enrichItem(item);
  }

  async getAll(options = {}) {
    const { search, warehouseId, productId } = options;

    const result = await docClient.send(new ScanCommand({
      TableName: INVENTORY_TABLE
    }));

    let items = result.Items || [];

    // Auto-populate inventory for products that don't have an inventory item yet in default warehouse
    if (items.length === 0 || options.autoSync) {
      const defaultLoc = await locationRepository.getDefault();
      const allProducts = await productRepository.getAll();
      const existingProductIds = new Set(items.map(i => i.productId));

      for (const prod of allProducts) {
        if (!existingProductIds.has(prod.productId)) {
          const newItem = await this.create({
            productId: prod.productId,
            warehouseId: defaultLoc.locationId,
            quantity: 0,
            reservedQuantity: 0,
            reorderLevel: 10
          });
          items.push(newItem);
        }
      }
    }

    // Filter by warehouseId if provided
    if (warehouseId) {
      items = items.filter(i => i.warehouseId === warehouseId);
    }

    // Filter by productId if provided
    if (productId) {
      items = items.filter(i => i.productId === productId);
    }

    // Enrich all items with product and warehouse data
    const enriched = await Promise.all(items.map(item => this.enrichItem(item)));

    // Apply text search
    if (search && search.trim()) {
      const term = search.toLowerCase().trim();
      return enriched.filter(item => {
        const prodName = item.product?.name?.toLowerCase() || '';
        const prodSku = item.product?.sku?.toLowerCase() || '';
        const whName = item.warehouse?.name?.toLowerCase() || '';
        return prodName.includes(term) || prodSku.includes(term) || whName.includes(term);
      });
    }

    return enriched;
  }

  async getOne(id) {
    const result = await docClient.send(new GetCommand({
      TableName: INVENTORY_TABLE,
      Key: { id }
    }));

    if (!result.Item) return null;
    return await this.enrichItem(result.Item);
  }

  async getByProductAndWarehouse(productId, warehouseId) {
    const result = await docClient.send(new ScanCommand({
      TableName: INVENTORY_TABLE,
      FilterExpression: 'productId = :productId AND warehouseId = :warehouseId',
      ExpressionAttributeValues: {
        ':productId': productId,
        ':warehouseId': warehouseId
      }
    }));

    const items = result.Items || [];
    return items.length > 0 ? items[0] : null;
  }

  async update(id, updates) {
    const existing = await this.getOne(id);
    if (!existing) throw new Error(`Inventory item ${id} not found`);

    let newQuantity = updates.quantity !== undefined ? parseInt(updates.quantity, 10) : existing.quantity;
    let newReserved = updates.reservedQuantity !== undefined ? parseInt(updates.reservedQuantity, 10) : existing.reservedQuantity;
    let newAvailable = Math.max(0, newQuantity - newReserved);
    let newReorder = updates.reorderLevel !== undefined ? parseInt(updates.reorderLevel, 10) : existing.reorderLevel;

    const updateExpressions = [
      '#quantity = :quantity',
      '#reservedQuantity = :reservedQuantity',
      '#availableQuantity = :availableQuantity',
      '#reorderLevel = :reorderLevel',
      '#updatedAt = :updatedAt'
    ];

    const expressionValues = {
      ':quantity': newQuantity,
      ':reservedQuantity': newReserved,
      ':availableQuantity': newAvailable,
      ':reorderLevel': newReorder,
      ':updatedAt': new Date().toISOString()
    };

    const expressionNames = {
      '#quantity': 'quantity',
      '#reservedQuantity': 'reservedQuantity',
      '#availableQuantity': 'availableQuantity',
      '#reorderLevel': 'reorderLevel',
      '#updatedAt': 'updatedAt'
    };

    await docClient.send(new UpdateCommand({
      TableName: INVENTORY_TABLE,
      Key: { id },
      UpdateExpression: `SET ${updateExpressions.join(', ')}`,
      ExpressionAttributeNames: expressionNames,
      ExpressionAttributeValues: expressionValues
    }));

    return await this.getOne(id);
  }

  async adjustStock(id, data) {
    const existing = await this.getOne(id);
    if (!existing) throw new Error(`Inventory item ${id} not found`);

    const rawQty = parseInt(data.quantity, 10) || 0;
    const reason = (data.reason || 'ADJUSTMENT').toUpperCase();
    const notes = data.notes || '';

    let delta = rawQty;
    // If reason is DAMAGE or LOST and quantity was sent as positive, negate it to reduce stock
    if ((reason === 'DAMAGE' || reason === 'LOST') && rawQty > 0) {
      delta = -rawQty;
    } else if ((reason === 'RESTOCK' || reason === 'RETURN') && rawQty < 0) {
      delta = Math.abs(rawQty);
    }

    const previousQuantity = existing.quantity || 0;
    const newQuantity = Math.max(0, previousQuantity + delta);
    const newAvailable = Math.max(0, newQuantity - (existing.reservedQuantity || 0));

    const type = delta >= 0 ? 'IN' : 'OUT';

    const updateExpressions = [
      '#quantity = :quantity',
      '#availableQuantity = :availableQuantity',
      '#updatedAt = :updatedAt'
    ];

    const expressionValues = {
      ':quantity': newQuantity,
      ':availableQuantity': newAvailable,
      ':updatedAt': new Date().toISOString()
    };

    const expressionNames = {
      '#quantity': 'quantity',
      '#availableQuantity': 'availableQuantity',
      '#updatedAt': 'updatedAt'
    };

    if (reason === 'RESTOCK') {
      updateExpressions.push('#lastRestockDate = :lastRestockDate');
      expressionValues[':lastRestockDate'] = new Date().toISOString();
      expressionNames['#lastRestockDate'] = 'lastRestockDate';
    }

    await docClient.send(new UpdateCommand({
      TableName: INVENTORY_TABLE,
      Key: { id },
      UpdateExpression: `SET ${updateExpressions.join(', ')}`,
      ExpressionAttributeNames: expressionNames,
      ExpressionAttributeValues: expressionValues
    }));

    // Record movement in Kardex
    await this._recordMovement({
      inventoryId: id,
      productId: existing.productId,
      warehouseId: existing.warehouseId,
      type,
      reason,
      quantity: Math.abs(delta),
      previousQuantity,
      newQuantity,
      notes
    });

    return await this.getOne(id);
  }

  async setVariantStock(variant, quantity, locationId) {
    const id = inventoryIdFor(variant.variantId, locationId);
    const row = await this.getOne(id);

    if (!row) {
      return this.create({
        productId: variant.productId,
        variantId: variant.variantId,
        warehouseId: locationId,
        quantity,
        reorderLevel: 10,
        notes: 'Stock inicial desde edición de variante'
      });
    }

    const delta = quantity - (row.quantity || 0);
    if (delta === 0) return row;

    return this.adjustStock(id, {
      quantity: delta,
      reason: 'ADJUSTMENT',
      notes: 'Ajuste de stock desde edición de variante'
    });
  }

  async getLowStock() {
    const all = await this.getAll();
    return all.filter(i => (i.quantity || 0) <= (i.reorderLevel || 10));
  }

  async _recordMovement(movement) {
    const movementId = 'mov_' + crypto.randomBytes(12).toString('hex');
    const record = {
      movementId,
      inventoryId: movement.inventoryId,
      productId: movement.productId,
      warehouseId: movement.warehouseId,
      type: movement.type, // 'IN' | 'OUT' | 'ADJUST'
      reason: movement.reason, // 'RESTOCK' | 'DAMAGE' | 'LOST' | 'RETURN' | 'ADJUSTMENT'
      quantity: movement.quantity,
      previousQuantity: movement.previousQuantity,
      newQuantity: movement.newQuantity,
      notes: movement.notes || '',
      createdAt: new Date().toISOString()
    };

    await docClient.send(new PutCommand({
      TableName: MOVEMENTS_TABLE,
      Item: record
    }));

    return record;
  }

  async getMovements(inventoryId) {
    const result = await docClient.send(new ScanCommand({
      TableName: MOVEMENTS_TABLE,
      FilterExpression: 'inventoryId = :inventoryId',
      ExpressionAttributeValues: {
        ':inventoryId': inventoryId
      }
    }));

    const items = result.Items || [];
    return items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  async enrichItem(item) {
    if (!item) return null;

    let product = item.product || null;
    if (!product && item.productId) {
      try {
        const prod = await productRepository.getOne(item.productId);
        if (prod) {
          product = {
            name: prod.name,
            sku: prod.sku,
            price: prod.price,
            images: prod.images || [],
            description: prod.description
          };
        }
      } catch (err) {
        console.warn(`Could not fetch product ${item.productId}:`, err.message);
      }
    }

    let warehouse = item.warehouse || null;
    if (!warehouse && item.warehouseId) {
      try {
        const loc = await locationRepository.getOne(item.warehouseId);
        if (loc) {
          warehouse = {
            name: loc.name,
            location: loc.location || loc.address || 'Sede Principal'
          };
        }
      } catch (err) {
        console.warn(`Could not fetch location ${item.warehouseId}:`, err.message);
      }
    }

    let variant = null;
    if (item.variantId) {
      try {
        const result = await docClient.send(new GetCommand({
          TableName: 'variants_table',
          Key: { variantId: item.variantId }
        }));
        if (result.Item) {
          const index = await loadAttributeIndex();
          variant = {
            variantId: result.Item.variantId,
            sku: result.Item.sku,
            price: result.Item.price,
            attributes: normalizeVariantAttributes(result.Item.attributes, index).map((a) => ({
              ...a,
              name: a.name ?? index.byId.get(a.attributeId)?.name ?? null
            }))
          };
        }
      } catch (err) {
        console.warn(`Could not fetch variant ${item.variantId}:`, err.message);
      }
    }

    return {
      ...item,
      variant,
      product: product || { name: 'Producto Desconocido', sku: 'N/A', price: 0 },
      warehouse: warehouse || { name: 'Bodega Principal', location: 'Sede Principal' }
    };
  }
}

module.exports = new InventoryRepository();
