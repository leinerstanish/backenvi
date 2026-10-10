'use strict';

const crypto = require('crypto');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, ScanCommand, GetCommand, UpdateCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({
  region: process.env.AWS_REGION || 'us-east-1'
});

const { runTransaction, putProduct, putVariant, lockSku, initialInventoryRow, putInventoryRow } = require('./catalogTransaction');

const docClient = DynamoDBDocumentClient.from(client);
const TABLE_NAME = 'products_table';

class ProductRepository {
  async create(productData) {
    const productId = 'prod_' + crypto.randomBytes(12).toString('hex');

    const product = {
      productId,
      name: productData.name,
      description: productData.description || '',
      categoryId: productData.categoryId || null,
      brandId: productData.brandId || null,
      images: productData.images || [],
      sku: productData.sku || '',
      price: productData.price || 0,
      cost: productData.cost || 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await docClient.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: product
    }));

    return product;
  }

  async createWithVariants(productData, variantsData, locationId) {
    const productId = 'prod_' + crypto.randomBytes(12).toString('hex');
    const now = new Date().toISOString();

    const product = {
      productId,
      name: productData.name,
      description: productData.description || '',
      categoryId: productData.categoryId || null,
      brandId: productData.brandId || null,
      images: productData.images || [],
      sku: productData.sku || '',
      price: productData.price || 0,
      cost: productData.cost || 0,
      fulfillment: productData.fulfillment || 'STOCK',
      supplierUrl: productData.supplierUrl || '',
      supplierLeadTimeDays: productData.supplierLeadTimeDays ?? null,
      internalNotes: productData.internalNotes || '',
      createdAt: now,
      updatedAt: now
    };

    const variants = variantsData.map((v) => ({
      variantId: 'var_' + crypto.randomBytes(12).toString('hex'),
      productId,
      sku: v.sku,
      price: v.price,
      attributes: v.attributes,
      images: v.images || [],
      createdAt: now,
      updatedAt: now
    }));

    await runTransaction([
      putProduct(product),
      ...variants.flatMap((v, i) => [
        putVariant(v),
        lockSku(v.sku, v.variantId),
        ...(locationId ? [putInventoryRow(initialInventoryRow(v, locationId, variantsData[i].stock || 0))] : [])
      ])
    ]);

    return { ...product, variants: variants.map((v, i) => ({ ...v, stock: variantsData[i].stock || 0, availableStock: variantsData[i].stock || 0 })) };
  }

  async createCombo(productData, comboVariants) {
    const productId = 'prod_' + crypto.randomBytes(12).toString('hex');
    const now = new Date().toISOString();

    const product = {
      productId,
      kind: 'COMBO',
      name: productData.name,
      description: productData.description || '',
      categoryId: productData.categoryId || null,
      brandId: productData.brandId || null,
      images: productData.images || [],
      sku: '',
      price: comboVariants.length ? comboVariants[0].price : 0,
      cost: 0,
      fulfillment: 'STOCK',
      comboComponents: productData.components,
      createdAt: now,
      updatedAt: now
    };

    const variants = comboVariants.map((v) => ({ ...v, productId }));

    await runTransaction([
      putProduct(product),
      ...variants.flatMap((v) => [putVariant(v), lockSku(v.sku, v.variantId)])
    ]);

    return { ...product, variants };
  }

  async getAll() {
    const result = await docClient.send(new ScanCommand({
      TableName: TABLE_NAME
    }));

    return result.Items || [];
  }

  async getOne(productId) {
    const result = await docClient.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: { productId }
    }));

    return result.Item || null;
  }

  async update(productId, updates) {
    const updateExpressions = [];
    const expressionValues = {};
    const expressionNames = {};

    Object.entries(updates).forEach(([key, value]) => {
      if (key !== 'productId') {
        const nameKey = `#${key}`;
        updateExpressions.push(`${nameKey} = :${key}`);
        expressionNames[nameKey] = key;
        expressionValues[`:${key}`] = value;
      }
    });

    if (updateExpressions.length === 0) {
      return this.getOne(productId);
    }

    updateExpressions.push(`#updatedAt = :updatedAt`);
    expressionNames['#updatedAt'] = 'updatedAt';
    expressionValues[':updatedAt'] = new Date().toISOString();

    await docClient.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { productId },
      UpdateExpression: `SET ${updateExpressions.join(', ')}`,
      ExpressionAttributeNames: expressionNames,
      ExpressionAttributeValues: expressionValues
    }));

    return this.getOne(productId);
  }

  async delete(productId) {
    await docClient.send(new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { productId }
    }));

    return true;
  }
}

module.exports = new ProductRepository();
