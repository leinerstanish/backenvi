'use strict';

const crypto = require('crypto');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, ScanCommand, UpdateCommand, TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
const paymentRepository = require('./paymentRepository');
const { HttpError } = require('./catalogRules');
const { calculateShippingFee } = require('./pricing');
const { assertTransition } = require('./orderStatus');
const { flattenStockLines } = require('./comboRules');
const { INVENTORY_TABLE, MOVEMENTS_TABLE, inventoryIdFor } = require('./inventoryKeys');

const client = new DynamoDBClient({
  region: process.env.AWS_REGION || 'us-east-1'
});

const docClient = DynamoDBDocumentClient.from(client);
const TABLE_NAME = 'sales_table';

class SaleRepository {
  async create(saleData) {
    const saleId = 'sale_' + crypto.randomBytes(12).toString('hex');
    const now = new Date().toISOString();

    let subtotal = 0;
    const enrichedItems = saleData.items.map((item) => {
      const price = parseFloat(item.price) || 0;
      const quantity = parseInt(item.quantity, 10);
      const itemSubtotal = price * quantity;
      subtotal += itemSubtotal;

      const external = item.fulfillment === 'EXTERNAL';
      return {
        productId: item.productId,
        variantId: item.variantId,
        sku: item.sku,
        attributes: item.attributes || [],
        fulfillment: item.fulfillment || 'STOCK',
        fulfillmentStatus: external ? 'TO_PURCHASE' : null,
        kind: item.kind || 'PRODUCT',
        components: item.components || null,
        locationId: item.locationId,
        name: item.name || '',
        price,
        quantity,
        subtotal: itemSubtotal
      };
    });

    const tax = 0;
    const shippingFee = calculateShippingFee(subtotal);
    const totalAmount = subtotal + shippingFee;
    const saleType = (saleData.saleType || 'CASH').toUpperCase();
    const initialPaymentAmount = parseFloat(saleData.initialPayment) || 0;

    let balanceDue = totalAmount;
    let status = 'PENDING';

    if (saleType === 'CASH') {
      balanceDue = 0;
      status = 'PAID';
    } else {
      balanceDue = totalAmount - initialPaymentAmount;
      if (balanceDue <= 0) {
        balanceDue = 0;
        status = 'PAID';
      } else if (initialPaymentAmount > 0) {
        status = 'PARTIAL';
      }
    }

    const newSale = {
      saleId,
      clientId: saleData.clientId || null,
      items: enrichedItems,
      subtotal,
      tax,
      shippingFee,
      totalAmount,
      fulfillmentStatus: 'PENDING',
      timeline: [{ type: 'CREATED', by: saleData.actor || 'sistema', at: new Date().toISOString() }],
      saleType,
      status,
      balanceDue,
      dueDate: saleData.dueDate || null,
      notes: saleData.notes || '',
      createdAt: now,
      updatedAt: now
    };

    const stockLines = flattenStockLines(enrichedItems);

    const stockOps = stockLines.flatMap((item) => {
      const inventoryId = inventoryIdFor(item.variantId, item.locationId);
      return [
        {
          Update: {
            TableName: INVENTORY_TABLE,
            Key: { id: inventoryId },
            UpdateExpression: 'SET #q = #q - :qty, #a = #a - :qty, #u = :now',
            ConditionExpression: '#a >= :qty',
            ExpressionAttributeNames: { '#q': 'quantity', '#a': 'availableQuantity', '#u': 'updatedAt' },
            ExpressionAttributeValues: { ':qty': item.quantity, ':now': now }
          }
        },
        {
          Put: {
            TableName: MOVEMENTS_TABLE,
            Item: {
              movementId: 'mov_' + crypto.randomBytes(12).toString('hex'),
              inventoryId,
              productId: item.productId,
              variantId: item.variantId,
              warehouseId: item.locationId,
              type: 'OUT',
              reason: 'SALE',
              quantity: item.quantity,
              notes: `Venta ${saleId}`,
              createdAt: now
            }
          }
        }
      ];
    });

    try {
      await docClient.send(new TransactWriteCommand({
        TransactItems: [
          { Put: { TableName: TABLE_NAME, Item: newSale, ConditionExpression: 'attribute_not_exists(saleId)' } },
          ...stockOps
        ]
      }));
    } catch (error) {
      const reasons = error.CancellationReasons || [];
      const failed = reasons.findIndex((r) => r.Code === 'ConditionalCheckFailed');
      const isStockOp = failed > 0 && (failed - 1) % 2 === 0;
      if (error.name === 'TransactionCanceledException' && isStockOp) {
        const item = stockLines[(failed - 1) / 2];
        throw new HttpError(409, `Sin stock suficiente de ${item.sku || item.variantId} en la bodega seleccionada`);
      }
      throw error;
    }

    let paymentRecord = null;
    const actualPaymentAmount = saleType === 'CASH' ? totalAmount : initialPaymentAmount;

    if (actualPaymentAmount > 0) {
      paymentRecord = await paymentRepository.create({
        saleId,
        clientId: saleData.clientId,
        amount: actualPaymentAmount,
        paymentMethod: saleData.paymentMethod || 'CASH',
        notes: `Pago inicial venta ${saleId}`
      });
    }

    return { sale: newSale, initialPayment: paymentRecord };
  }

  async getAll() {
    const result = await docClient.send(new ScanCommand({
      TableName: TABLE_NAME
    }));
    return result.Items || [];
  }

  async getOne(saleId) {
    const result = await docClient.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: { saleId }
    }));
    return result.Item || null;
  }

  async changeFulfillment(saleId, { to, note, actor }) {
    const sale = await this.getOne(saleId);
    if (!sale) return null;

    const from = sale.fulfillmentStatus || 'PENDING';
    assertTransition(from, to);

    const items = sale.items || [];
    if (to === 'SHIPPED' && items.some((i) => i.fulfillment === 'EXTERNAL' && i.fulfillmentStatus !== 'PURCHASED')) {
      throw new HttpError(409, 'Hay productos externos que aún no se han comprado');
    }

    const now = new Date().toISOString();
    const event = { type: 'FULFILLMENT', from, to, note: note || '', by: actor, at: now };

    const updateNames = { '#fs': 'fulfillmentStatus', '#tl': 'timeline', '#u': 'updatedAt' };
    const updateValues = { ':to': to, ':from': from, ':ev': [event], ':empty': [], ':now': now };
    let updateExpression = 'SET #fs = :to, #tl = list_append(if_not_exists(#tl, :empty), :ev), #u = :now';

    if (to === 'DELIVERED') {
      updateNames['#items'] = 'items';
      updateValues[':items'] = items.map((i) => ({
        ...i,
        reviewToken: i.reviewToken || `${saleId}.${crypto.randomBytes(16).toString('hex')}`
      }));
      updateExpression += ', #items = :items';
    }

    const transactItems = [{
      Update: {
        TableName: TABLE_NAME,
        Key: { saleId },
        UpdateExpression: updateExpression,
        ConditionExpression: from === 'PENDING' ? '(attribute_not_exists(#fs) OR #fs = :from)' : '#fs = :from',
        ExpressionAttributeNames: updateNames,
        ExpressionAttributeValues: updateValues
      }
    }];

    if (to === 'CANCELLED') {
      for (const item of flattenStockLines(items)) {
        const inventoryId = inventoryIdFor(item.variantId, item.locationId);
        transactItems.push({
          Update: {
            TableName: INVENTORY_TABLE,
            Key: { id: inventoryId },
            UpdateExpression: 'SET #q = #q + :qty, #a = #a + :qty, #u = :now',
            ConditionExpression: 'attribute_exists(id)',
            ExpressionAttributeNames: { '#q': 'quantity', '#a': 'availableQuantity', '#u': 'updatedAt' },
            ExpressionAttributeValues: { ':qty': item.quantity, ':now': now }
          }
        });
        transactItems.push({
          Put: {
            TableName: MOVEMENTS_TABLE,
            Item: {
              movementId: 'mov_' + crypto.randomBytes(12).toString('hex'),
              inventoryId,
              productId: item.productId,
              variantId: item.variantId,
              warehouseId: item.locationId,
              type: 'IN',
              reason: 'CANCELLATION',
              quantity: item.quantity,
              notes: `Cancelación venta ${saleId}`,
              createdAt: now
            }
          }
        });
      }
    }

    try {
      await docClient.send(new TransactWriteCommand({ TransactItems: transactItems }));
    } catch (error) {
      if (error.name === 'TransactionCanceledException') {
        const reasons = error.CancellationReasons || [];
        if (reasons[0] && reasons[0].Code === 'ConditionalCheckFailed') {
          throw new HttpError(409, 'La venta cambió mientras la actualizabas. Recarga e intenta de nuevo');
        }
        if (reasons.some((r) => r.Code === 'ConditionalCheckFailed')) {
          throw new HttpError(409, 'No se encontró el inventario de una de las líneas para devolver el stock');
        }
      }
      throw error;
    }

    return this.getOne(saleId);
  }

  async markLinePurchased(saleId, index, { actor }) {
    const sale = await this.getOne(saleId);
    if (!sale) return null;

    const item = (sale.items || [])[index];
    if (!item || item.fulfillment !== 'EXTERNAL' || item.fulfillmentStatus !== 'TO_PURCHASE') {
      throw new HttpError(409, 'La línea no es un producto externo pendiente de compra');
    }

    const now = new Date().toISOString();
    const event = { type: 'LINE_PURCHASED', lineIndex: index, sku: item.sku, by: actor, at: now };

    try {
      await docClient.send(new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { saleId },
        UpdateExpression: `SET #items[${index}].#fs = :p, #tl = list_append(if_not_exists(#tl, :empty), :ev), #u = :now`,
        ConditionExpression: `#items[${index}].#fs = :from`,
        ExpressionAttributeNames: { '#items': 'items', '#fs': 'fulfillmentStatus', '#tl': 'timeline', '#u': 'updatedAt' },
        ExpressionAttributeValues: { ':p': 'PURCHASED', ':from': 'TO_PURCHASE', ':ev': [event], ':empty': [], ':now': now }
      }));
    } catch (error) {
      if (error.name === 'ConditionalCheckFailedException') {
        throw new HttpError(409, 'La línea ya fue marcada o cambió. Recarga e intenta de nuevo');
      }
      throw error;
    }

    return this.getOne(saleId);
  }

  async setReceipt(saleId, { receiptNumber, receiptKey }) {
    await docClient.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { saleId },
      UpdateExpression: 'SET receiptNumber = :n, receiptKey = :k, receiptCreatedAt = :t',
      ExpressionAttributeValues: { ':n': receiptNumber, ':k': receiptKey, ':t': new Date().toISOString() }
    }));
  }

  async hasSalesForProduct(productId) {
    const sales = await this.getAll();
    return sales.some((sale) => (sale.items || []).some((item) => item.productId === productId));
  }

  async updateStatusAndBalance(saleId, paymentAmount) {
    const sale = await this.getOne(saleId);
    if (!sale) throw new Error('Sale not found');

    let newBalanceDue = sale.balanceDue - paymentAmount;
    if (newBalanceDue < 0) newBalanceDue = 0;

    let newStatus = sale.status;
    if (newBalanceDue === 0) {
      newStatus = 'PAID';
    } else if (newBalanceDue < sale.totalAmount) {
      newStatus = 'PARTIAL';
    }

    const result = await docClient.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { saleId },
      UpdateExpression: 'SET balanceDue = :balanceDue, #status = :status, updatedAt = :updatedAt',
      ExpressionAttributeNames: {
        '#status': 'status'
      },
      ExpressionAttributeValues: {
        ':balanceDue': newBalanceDue,
        ':status': newStatus,
        ':updatedAt': new Date().toISOString()
      },
      ReturnValues: 'ALL_NEW'
    }));

    return result.Attributes;
  }

  async update(saleId, updates) {
    const sale = await this.getOne(saleId);
    if (!sale) return null;

    const allowedFields = ['notes', 'dueDate'];
    const updateExpressions = [];
    const expressionAttributeValues = {};

    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key)) {
        updateExpressions.push(`${key} = :${key}`);
        expressionAttributeValues[`:${key}`] = value;
      }
    }

    if (updateExpressions.length === 0) {
      return sale;
    }

    updateExpressions.push('updatedAt = :updatedAt');
    expressionAttributeValues[':updatedAt'] = new Date().toISOString();

    const result = await docClient.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { saleId },
      UpdateExpression: `SET ${updateExpressions.join(', ')}`,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: 'ALL_NEW'
    }));

    return result.Attributes;
  }
}

module.exports = new SaleRepository();
