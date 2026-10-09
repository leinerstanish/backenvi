'use strict';

const crypto = require('crypto');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, ScanCommand, GetCommand, UpdateCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({
  region: process.env.AWS_REGION || 'us-east-1'
});

const docClient = DynamoDBDocumentClient.from(client);
const TABLE_NAME = 'attributes_table';

class AttributeRepository {
  async create(attributeData) {
    const attributeId = 'attr_' + crypto.randomBytes(12).toString('hex');

    const attribute = {
      attributeId,
      name: attributeData.name,
      type: attributeData.type || 'TEXT',
      isRequired: !!attributeData.isRequired,
      isPublished: attributeData.isPublished !== false,
      values: attributeData.values || [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await docClient.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: attribute
    }));

    return attribute;
  }

  async getAll() {
    const result = await docClient.send(new ScanCommand({
      TableName: TABLE_NAME
    }));

    return result.Items || [];
  }

  async getOne(attributeId) {
    const result = await docClient.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: { attributeId }
    }));

    return result.Item || null;
  }

  async update(attributeId, updates) {
    const updateExpressions = [];
    const expressionValues = {};
    const expressionNames = {};

    Object.entries(updates).forEach(([key, value]) => {
      if (key !== 'attributeId') {
        const nameKey = `#${key}`;
        updateExpressions.push(`${nameKey} = :${key}`);
        expressionNames[nameKey] = key;
        expressionValues[`:${key}`] = value;
      }
    });

    if (updateExpressions.length === 0) {
      return this.getOne(attributeId);
    }

    updateExpressions.push(`#updatedAt = :updatedAt`);
    expressionNames['#updatedAt'] = 'updatedAt';
    expressionValues[':updatedAt'] = new Date().toISOString();

    await docClient.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { attributeId },
      UpdateExpression: `SET ${updateExpressions.join(', ')}`,
      ConditionExpression: 'attribute_exists(attributeId)',
      ExpressionAttributeNames: expressionNames,
      ExpressionAttributeValues: expressionValues
    }));

    return this.getOne(attributeId);
  }

  async delete(attributeId) {
    await docClient.send(new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { attributeId }
    }));

    return true;
  }
}

module.exports = new AttributeRepository();
