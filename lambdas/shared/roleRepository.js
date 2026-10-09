'use strict';

const crypto = require('crypto');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, ScanCommand, GetCommand, UpdateCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({
  region: process.env.AWS_REGION || 'us-east-1'
});

const docClient = DynamoDBDocumentClient.from(client);
const TABLE_NAME = 'roles_table';

class RoleRepository {
  async create(roleData) {
    const roleId = 'rol_' + crypto.randomBytes(12).toString('hex');

    const role = {
      roleId,
      name: roleData.name,
      permissions: roleData.permissions || [],
      description: roleData.description || '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await docClient.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: role
    }));

    return role;
  }

  async getAll() {
    const result = await docClient.send(new ScanCommand({
      TableName: TABLE_NAME
    }));

    return result.Items || [];
  }

  async getOne(roleId) {
    const result = await docClient.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: { roleId }
    }));

    return result.Item || null;
  }

  async update(roleId, updates) {
    const updateExpressions = [];
    const expressionValues = {};
    const expressionNames = {};

    Object.entries(updates).forEach(([key, value]) => {
      if (key !== 'roleId') {
        const nameKey = `#${key}`;
        updateExpressions.push(`${nameKey} = :${key}`);
        expressionNames[nameKey] = key;
        expressionValues[`:${key}`] = value;
      }
    });

    if (updateExpressions.length === 0) {
      return this.getOne(roleId);
    }

    updateExpressions.push(`#updatedAt = :updatedAt`);
    expressionNames['#updatedAt'] = 'updatedAt';
    expressionValues[':updatedAt'] = new Date().toISOString();

    await docClient.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { roleId },
      UpdateExpression: `SET ${updateExpressions.join(', ')}`,
      ExpressionAttributeNames: expressionNames,
      ExpressionAttributeValues: expressionValues
    }));

    return this.getOne(roleId);
  }

  async delete(roleId) {
    await docClient.send(new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { roleId }
    }));

    return true;
  }
}

module.exports = new RoleRepository();
