'use strict';

const crypto = require('crypto');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, ScanCommand, GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { scanAll } = require('./scanAll');

const client = new DynamoDBClient({
  region: process.env.AWS_REGION || 'us-east-1'
});

const docClient = DynamoDBDocumentClient.from(client);
const TABLE_NAME = 'payments_table';

class PaymentRepository {
  async create(paymentData) {
    const paymentId = 'pay_' + crypto.randomBytes(12).toString('hex');

    const newPayment = {
      paymentId,
      saleId: paymentData.saleId,
      clientId: paymentData.clientId || null,
      amount: parseFloat(paymentData.amount) || 0,
      paymentMethod: paymentData.paymentMethod || 'CASH', // CASH, CARD, TRANSFER
      notes: paymentData.notes || '',
      paymentDate: paymentData.paymentDate || new Date().toISOString(),
      createdAt: new Date().toISOString()
    };

    await docClient.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: newPayment
    }));

    return newPayment;
  }

  async getAll(options = {}) {
    let result;
    
    // We could add GSI for saleId, but for simplicity we'll just scan and filter if needed, 
    // or use Scan with FilterExpression for small datasets.
    // For a real production app with many payments, add a GSI on saleId.
    
    if (options.saleId) {
      result = await scanAll(docClient, ({
        TableName: TABLE_NAME,
        FilterExpression: 'saleId = :saleId',
        ExpressionAttributeValues: {
          ':saleId': options.saleId
        }
      }));
    } else {
      result = await scanAll(docClient, ({
        TableName: TABLE_NAME
      }));
    }

    return result.Items || [];
  }

  async getOne(paymentId) {
    const result = await docClient.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: { paymentId }
    }));

    return result.Item || null;
  }

  async updateAmount(paymentId, amount) {
    const result = await docClient.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { paymentId },
      UpdateExpression: 'SET amount = :amount, updatedAt = :now',
      ExpressionAttributeValues: {
        ':amount': Math.max(0, parseFloat(amount) || 0),
        ':now': new Date().toISOString()
      },
      ReturnValues: 'ALL_NEW'
    }));
    return result.Attributes;
  }
}

module.exports = new PaymentRepository();
