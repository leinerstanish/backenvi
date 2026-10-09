'use strict';

const crypto = require('crypto');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, ScanCommand, GetCommand, UpdateCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({
  region: process.env.AWS_REGION || 'us-east-1'
});

const docClient = DynamoDBDocumentClient.from(client);
const TABLE_NAME = 'clients_table';

class ClientRepository {
  async create(clientData) {
    const clientId = 'client_' + crypto.randomBytes(12).toString('hex');

    const newClient = {
      clientId,
      name: clientData.name,
      email: clientData.email || '',
      phone: clientData.phone || '',
      documentId: clientData.documentId || '', // Cédula/NIT
      address: clientData.address || '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await docClient.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: newClient
    }));

    return newClient;
  }

  async getAll() {
    const result = await docClient.send(new ScanCommand({
      TableName: TABLE_NAME
    }));

    return result.Items || [];
  }

  async getOne(clientId) {
    const result = await docClient.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: { clientId }
    }));

    return result.Item || null;
  }

  async update(clientId, updates) {
    const updateExpressions = [];
    const expressionValues = {};
    const expressionNames = {};

    Object.entries(updates).forEach(([key, value]) => {
      if (key !== 'clientId' && key !== 'createdAt') {
        const nameKey = `#${key}`;
        updateExpressions.push(`${nameKey} = :${key}`);
        expressionValues[`:${key}`] = value;
        expressionNames[nameKey] = key;
      }
    });

    if (updateExpressions.length === 0) return this.getOne(clientId);

    updateExpressions.push('#updatedAt = :updatedAt');
    expressionValues[':updatedAt'] = new Date().toISOString();
    expressionNames['#updatedAt'] = 'updatedAt';

    const result = await docClient.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { clientId },
      UpdateExpression: `SET ${updateExpressions.join(', ')}`,
      ExpressionAttributeNames: expressionNames,
      ExpressionAttributeValues: expressionValues,
      ReturnValues: 'ALL_NEW'
    }));

    return result.Attributes;
  }
}

module.exports = new ClientRepository();
