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
const { scanAll } = require('./scanAll');

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
    const shippingFee =
      saleData.shippingFee !== undefined && saleData.shippingFee !== null && saleData.shippingFee !== ''
        ? Math.max(0, parseFloat(saleData.shippingFee) || 0)
        : calculateShippingFee(subtotal);
    const totalAmount = subtotal + shippingFee;
    const saleType = (saleData.saleType || 'CASH').toUpperCase();
    const initialPaymentAmount = parseFloat(saleData.initialPayment) || 0;

    let balanceDue = totalAmount;
    let status = 'PENDING';

    if (saleData.awaitingPayment) {
      // Compra en la tienda: el stock queda reservado hasta que la pasarela confirme el pago.
      status = 'PENDING_PAYMENT';
    } else if (saleType === 'CASH') {
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
      channel: saleData.channel || 'ADMIN',
      paymentMethod: saleData.paymentMethod || 'CASH',
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
    const actualPaymentAmount = status === 'PENDING_PAYMENT' ? 0
      : saleType === 'CASH' ? totalAmount : initialPaymentAmount;

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
    const result = await scanAll(docClient, ({
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

    if (to === 'CANCELLED' && (sale.status === 'CANCELLED' || sale.fulfillmentStatus === 'CANCELLED')) {
      return sale;
    }

    const from = sale.fulfillmentStatus || 'PENDING';
    assertTransition(from, to);

    const awaitingPayment = sale.status === 'PENDING_PAYMENT';
    if (awaitingPayment && to !== 'CANCELLED') {
      throw new HttpError(409, 'El pedido aún no tiene el pago confirmado');
    }

    const items = sale.items || [];
    if (to === 'SHIPPED' && items.some((i) => i.fulfillment === 'EXTERNAL' && i.fulfillmentStatus !== 'PURCHASED')) {
      throw new HttpError(409, 'Hay productos externos que aún no se han comprado');
    }

    const now = new Date().toISOString();
    const event = { type: 'FULFILLMENT', from, to, note: note || '', by: actor, at: now };

    const updateNames = { '#fs': 'fulfillmentStatus', '#tl': 'timeline', '#u': 'updatedAt' };
    const updateValues = { ':to': to, ':ev': [event], ':empty': [], ':now': now };
    let updateExpression = 'SET #fs = :to, #tl = list_append(if_not_exists(#tl, :empty), :ev), #u = :now';
    let condition = 'attribute_exists(saleId)';

    if (to === 'CANCELLED') {
      updateNames['#st'] = 'status';
      updateNames['#bd'] = 'balanceDue';
      updateValues[':cancelled'] = 'CANCELLED';
      updateValues[':zero'] = 0;
      updateExpression += ', #st = :cancelled, #bd = :zero';
    } else {
      updateValues[':from'] = from;
      condition = from === 'PENDING' ? '(attribute_not_exists(#fs) OR #fs = :from)' : '#fs = :from';
    }

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
        ConditionExpression: condition,
        ExpressionAttributeNames: updateNames,
        ExpressionAttributeValues: updateValues
      }
    }];

    if (to === 'CANCELLED') {
      const groupedLines = new Map();
      for (const item of flattenStockLines(items)) {
        const qty = Number(item.quantity) || 0;
        if (qty <= 0 || !item.variantId || !item.locationId) continue;
        const inventoryId = inventoryIdFor(item.variantId, item.locationId);
        const existing = groupedLines.get(inventoryId);
        if (existing) {
          existing.quantity += qty;
        } else {
          groupedLines.set(inventoryId, { ...item, quantity: qty, inventoryId });
        }
      }

      for (const line of groupedLines.values()) {
        const invCheck = await docClient.send(new GetCommand({
          TableName: INVENTORY_TABLE,
          Key: { id: line.inventoryId }
        })).catch(() => ({ Item: null }));

        if (!invCheck || !invCheck.Item) {
          continue;
        }

        transactItems.push({
          Update: {
            TableName: INVENTORY_TABLE,
            Key: { id: line.inventoryId },
            UpdateExpression: 'SET #q = if_not_exists(#q, :zero) + :qty, #a = if_not_exists(#a, :zero) + :qty, #u = :now',
            ExpressionAttributeNames: { '#q': 'quantity', '#a': 'availableQuantity', '#u': 'updatedAt' },
            ExpressionAttributeValues: { ':qty': line.quantity, ':zero': 0, ':now': now }
          }
        });
        transactItems.push({
          Put: {
            TableName: MOVEMENTS_TABLE,
            Item: {
              movementId: 'mov_' + crypto.randomBytes(12).toString('hex'),
              inventoryId: line.inventoryId,
              productId: line.productId,
              variantId: line.variantId,
              warehouseId: line.locationId,
              type: 'IN',
              reason: 'CANCELLATION',
              quantity: line.quantity,
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
    return sales.some(
      (sale) =>
        sale.status !== 'CANCELLED' &&
        sale.fulfillmentStatus !== 'CANCELLED' &&
        (sale.items || []).some((item) => item.productId === productId)
    );
  }

  /** Marca pagada una venta PENDING_PAYMENT. Solo un llamado gana, así webhooks repetidos no duplican el pago. */
  async markPaidOnline(saleId, payment) {
    const now = new Date().toISOString();
    const event = { type: 'PAYMENT_APPROVED', provider: payment.provider, transactionId: payment.transactionId, by: payment.provider, at: now };
    try {
      const result = await docClient.send(new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { saleId },
        UpdateExpression: 'SET #st = :paid, balanceDue = :zero, onlinePayment = :payment, #tl = list_append(if_not_exists(#tl, :empty), :ev), #u = :now',
        ConditionExpression: '#st = :pending',
        ExpressionAttributeNames: { '#st': 'status', '#tl': 'timeline', '#u': 'updatedAt' },
        ExpressionAttributeValues: {
          ':paid': 'PAID', ':pending': 'PENDING_PAYMENT', ':zero': 0,
          ':payment': { ...payment, approvedAt: now }, ':ev': [event], ':empty': [], ':now': now
        },
        ReturnValues: 'ALL_NEW'
      }));
      return { applied: true, sale: result.Attributes };
    } catch (error) {
      if (error.name === 'ConditionalCheckFailedException') return { applied: false };
      throw error;
    }
  }

  /** Guarda un intento de pago no aprobado (o un pago que llegó a un pedido ya cancelado) sin repetir el mismo evento. */
  async recordPaymentAttempt(saleId, attempt) {
    const now = new Date().toISOString();
    const event = { type: 'PAYMENT_ATTEMPT', status: attempt.status, transactionId: attempt.transactionId, by: attempt.provider, at: now };
    try {
      await docClient.send(new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { saleId },
        UpdateExpression: 'SET lastPaymentAttempt = :a, #tl = list_append(if_not_exists(#tl, :empty), :ev), #u = :now',
        ConditionExpression: 'attribute_exists(saleId) AND (attribute_not_exists(lastPaymentAttempt) OR lastPaymentAttempt.transactionId <> :tx OR lastPaymentAttempt.#s <> :s)',
        ExpressionAttributeNames: { '#tl': 'timeline', '#u': 'updatedAt', '#s': 'status' },
        ExpressionAttributeValues: {
          ':a': { ...attempt, at: now }, ':tx': attempt.transactionId, ':s': attempt.status,
          ':ev': [event], ':empty': [], ':now': now
        }
      }));
    } catch (error) {
      if (error.name !== 'ConditionalCheckFailedException') throw error;
    }
  }

  async getPendingPaymentBefore(isoDate) {
    const items = [];
    let ExclusiveStartKey;
    do {
      const result = await docClient.send(new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: '#st = :pending AND createdAt < :cutoff',
        ExpressionAttributeNames: { '#st': 'status' },
        ExpressionAttributeValues: { ':pending': 'PENDING_PAYMENT', ':cutoff': isoDate },
        ExclusiveStartKey
      }));
      items.push(...(result.Items || []));
      ExclusiveStartKey = result.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return items;
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
    if (updates && (updates.status === 'CANCELLED' || updates.fulfillmentStatus === 'CANCELLED')) {
      return this.changeFulfillment(saleId, {
        to: 'CANCELLED',
        note: updates.notes || 'Cancelada desde administración',
        actor: 'admin'
      });
    }

    const sale = await this.getOne(saleId);
    if (!sale) return null;

    const now = new Date().toISOString();
    const updateNames = { '#u': 'updatedAt' };
    const updateValues = { ':updatedAt': now };
    const sets = ['#u = :updatedAt'];

    if (updates.notes !== undefined) {
      updateNames['#notes'] = 'notes';
      updateValues[':notes'] = updates.notes;
      sets.push('#notes = :notes');
    }

    if (updates.dueDate !== undefined) {
      updateNames['#dueDate'] = 'dueDate';
      updateValues[':dueDate'] = updates.dueDate || null;
      sets.push('#dueDate = :dueDate');
    }

    const hasFinancialChanges =
      Array.isArray(updates.items) ||
      updates.shippingFee !== undefined ||
      updates.saleType !== undefined;

    if (hasFinancialChanges) {
      const currentItems = Array.isArray(sale.items) ? sale.items : [];
      const nextItems = Array.isArray(updates.items)
        ? currentItems.map((item, idx) => {
            const patch = updates.items[idx] || {};
            const price =
              patch.price !== undefined && patch.price !== null
                ? Math.max(0, parseFloat(patch.price) || 0)
                : Number(item.price) || 0;
            const quantity = Number(item.quantity) || 1;
            return {
              ...item,
              price,
              subtotal: price * quantity
            };
          })
        : currentItems;

      const nextSubtotal = nextItems.reduce(
        (sum, item) => sum + (Number(item.price) || 0) * (Number(item.quantity) || 1),
        0
      );
      const nextShippingFee =
        updates.shippingFee !== undefined && updates.shippingFee !== null && updates.shippingFee !== ''
          ? Math.max(0, parseFloat(updates.shippingFee) || 0)
          : Number(sale.shippingFee) || 0;
      const nextTotalAmount = nextSubtotal + nextShippingFee;
      const nextSaleType = updates.saleType ? String(updates.saleType).toUpperCase() : (sale.saleType || 'CASH');

      const payments = await paymentRepository.getAll({ saleId }).catch(() => []);
      let nextBalanceDue = sale.balanceDue || 0;
      let nextStatus = sale.status || 'PAID';

      if (sale.status !== 'CANCELLED' && sale.fulfillmentStatus !== 'CANCELLED') {
        if (nextSaleType === 'CASH' && sale.status !== 'PENDING_PAYMENT') {
          nextBalanceDue = 0;
          nextStatus = 'PAID';
          if (payments.length === 1 && payments[0].paymentId) {
            await paymentRepository.updateAmount(payments[0].paymentId, nextTotalAmount).catch(() => null);
          }
        } else {
          const totalPaid = payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
          nextBalanceDue = Math.max(0, nextTotalAmount - totalPaid);
          if (sale.status !== 'PENDING_PAYMENT') {
            nextStatus = nextBalanceDue === 0 ? 'PAID' : totalPaid > 0 ? 'PARTIAL' : 'PENDING';
          }
        }
      }

      updateNames['#items'] = 'items';
      updateNames['#sub'] = 'subtotal';
      updateNames['#ship'] = 'shippingFee';
      updateNames['#tot'] = 'totalAmount';
      updateNames['#bd'] = 'balanceDue';
      updateNames['#st'] = 'status';
      updateNames['#stype'] = 'saleType';

      updateValues[':items'] = nextItems;
      updateValues[':sub'] = nextSubtotal;
      updateValues[':ship'] = nextShippingFee;
      updateValues[':tot'] = nextTotalAmount;
      updateValues[':bd'] = nextBalanceDue;
      updateValues[':st'] = nextStatus;
      updateValues[':stype'] = nextSaleType;

      sets.push(
        '#items = :items',
        '#sub = :sub',
        '#ship = :ship',
        '#tot = :tot',
        '#bd = :bd',
        '#st = :st',
        '#stype = :stype'
      );
    }

    if (sets.length === 1) {
      return sale;
    }

    const result = await docClient.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { saleId },
      UpdateExpression: `SET ${sets.join(', ')}`,
      ExpressionAttributeNames: updateNames,
      ExpressionAttributeValues: updateValues,
      ReturnValues: 'ALL_NEW'
    }));

    return result.Attributes;
  }
}

module.exports = new SaleRepository();
