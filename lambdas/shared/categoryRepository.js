'use strict';

const crypto = require('crypto');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, ScanCommand, GetCommand, UpdateCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({
  region: process.env.AWS_REGION || 'us-east-1'
});

const docClient = DynamoDBDocumentClient.from(client);
const TABLE_NAME = 'categories_table';

class CategoryRepository {
  async create(categoryData) {
    const categoryId = 'cat_' + crypto.randomBytes(12).toString('hex');

    const category = {
      categoryId,
      name: categoryData.name,
      description: categoryData.description || '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    if (categoryData.parentId) {
      category.parentId = categoryData.parentId;
    }

    await docClient.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: category
    }));

    return category;
  }

  async getAll() {
    const result = await docClient.send(new ScanCommand({
      TableName: TABLE_NAME
    }));

    return result.Items || [];
  }

  async getByParentId(parentId) {
    const result = await docClient.send(new ScanCommand({
      TableName: TABLE_NAME,
      FilterExpression: 'parentId = :parentId',
      ExpressionAttributeValues: {
        ':parentId': parentId
      }
    }));

    return result.Items || [];
  }

  async getOne(categoryId) {
    const result = await docClient.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: { categoryId }
    }));

    return result.Item || null;
  }

  async update(categoryId, updates) {
    const updateExpressions = [];
    const expressionValues = {};
    const expressionNames = {};

    Object.entries(updates).forEach(([key, value]) => {
      if (key !== 'categoryId') {
        const nameKey = `#${key}`;
        updateExpressions.push(`${nameKey} = :${key}`);
        expressionNames[nameKey] = key;
        expressionValues[`:${key}`] = value;
      }
    });

    if (updateExpressions.length === 0) {
      return this.getOne(categoryId);
    }

    updateExpressions.push(`#updatedAt = :updatedAt`);
    expressionNames['#updatedAt'] = 'updatedAt';
    expressionValues[':updatedAt'] = new Date().toISOString();

    await docClient.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { categoryId },
      UpdateExpression: `SET ${updateExpressions.join(', ')}`,
      ExpressionAttributeNames: expressionNames,
      ExpressionAttributeValues: expressionValues
    }));

    return this.getOne(categoryId);
  }

  async delete(categoryId) {
    await docClient.send(new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { categoryId }
    }));

    return true;
  }
}

module.exports = new CategoryRepository();
