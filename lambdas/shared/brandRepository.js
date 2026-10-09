'use strict';

const crypto = require('crypto');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, ScanCommand, GetCommand, UpdateCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({
  region: process.env.AWS_REGION || 'us-east-1'
});

const docClient = DynamoDBDocumentClient.from(client);
const TABLE_NAME = 'brands_table';

class BrandRepository {
  async create(brandData) {
    const brandId = 'brand_' + crypto.randomBytes(12).toString('hex');

    const brand = {
      brandId,
      name: brandData.name,
      description: brandData.description || '',
      logoUrl: brandData.logoUrl || '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await docClient.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: brand
    }));

    return brand;
  }

  async getAll() {
    const result = await docClient.send(new ScanCommand({
      TableName: TABLE_NAME
    }));

    return result.Items || [];
  }

  async getOne(brandId) {
    const result = await docClient.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: { brandId }
    }));

    return result.Item || null;
  }

  async update(brandId, updates) {
    const updateExpressions = [];
    const expressionValues = {};
    const expressionNames = {};

    Object.entries(updates).forEach(([key, value]) => {
      if (key !== 'brandId') {
        const nameKey = `#${key}`;
        updateExpressions.push(`${nameKey} = :${key}`);
        expressionNames[nameKey] = key;
        expressionValues[`:${key}`] = value;
      }
    });

    if (updateExpressions.length === 0) {
      return this.getOne(brandId);
    }

    updateExpressions.push(`#updatedAt = :updatedAt`);
    expressionNames['#updatedAt'] = 'updatedAt';
    expressionValues[':updatedAt'] = new Date().toISOString();

    await docClient.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { brandId },
      UpdateExpression: `SET ${updateExpressions.join(', ')}`,
      ExpressionAttributeNames: expressionNames,
      ExpressionAttributeValues: expressionValues
    }));

    return this.getOne(brandId);
  }

  async delete(brandId) {
    await docClient.send(new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { brandId }
    }));

    return true;
  }
}

module.exports = new BrandRepository();
