'use strict';

const crypto = require('crypto');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, ScanCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');

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
      result = await docClient.send(new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: 'saleId = :saleId',
        ExpressionAttributeValues: {
          ':saleId': options.saleId
        }
      }));
    } else {
      result = await docClient.send(new ScanCommand({
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
}

module.exports = new PaymentRepository();
