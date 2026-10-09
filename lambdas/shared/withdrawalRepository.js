'use strict';

const crypto = require('crypto');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, ScanCommand, GetCommand, UpdateCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({
  region: process.env.AWS_REGION || 'us-east-1'
});

const docClient = DynamoDBDocumentClient.from(client);
const TABLE_NAME = 'withdrawals_table';

class WithdrawalRepository {
  async create(withdrawalData) {
    const withdrawalId = 'withdrawal_' + crypto.randomBytes(12).toString('hex');

    const withdrawal = {
      withdrawalId,
      amount: parseFloat(withdrawalData.amount) || 0,
      observation: withdrawalData.observation || '',
      date: withdrawalData.date || new Date().toISOString(),
      userId: withdrawalData.userId || null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await docClient.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: withdrawal
    }));

    return withdrawal;
  }

  async getAll() {
    const result = await docClient.send(new ScanCommand({
      TableName: TABLE_NAME
    }));
    return result.Items || [];
  }

  async getOne(withdrawalId) {
    const result = await docClient.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: { withdrawalId }
    }));
    return result.Item || null;
  }

  async update(withdrawalId, updates) {
    const withdrawal = await this.getOne(withdrawalId);
    if (!withdrawal) return null;

    const allowedFields = ['amount', 'observation', 'date'];
    const updateExpressions = [];
    const expressionValues = {};

    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key) && value !== null && value !== undefined) {
        updateExpressions.push(`${key} = :${key}`);
        expressionValues[`:${key}`] = key === 'amount' ? parseFloat(value) : value;
      }
    }

    if (updateExpressions.length === 0) {
      return withdrawal;
    }

    updateExpressions.push('updatedAt = :updatedAt');
    expressionValues[':updatedAt'] = new Date().toISOString();

    const result = await docClient.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { withdrawalId },
      UpdateExpression: `SET ${updateExpressions.join(', ')}`,
      ExpressionAttributeValues: expressionValues,
      ReturnValues: 'ALL_NEW'
    }));

    return result.Attributes;
  }

  async delete(withdrawalId) {
    await docClient.send(new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { withdrawalId }
    }));
    return true;
  }

  async getTotalWithdrawn(startDate, endDate) {
    const result = await docClient.send(new ScanCommand({
      TableName: TABLE_NAME,
      FilterExpression: '#date BETWEEN :startDate AND :endDate',
      ExpressionAttributeNames: { '#date': 'date' },
      ExpressionAttributeValues: {
        ':startDate': startDate,
        ':endDate': endDate
      }
    }));

    const items = result.Items || [];
    return items.reduce((sum, item) => sum + (item.amount || 0), 0);
  }
}

module.exports = new WithdrawalRepository();
