'use strict';

const crypto = require('crypto');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, ScanCommand, GetCommand, UpdateCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({
  region: process.env.AWS_REGION || 'us-east-1'
});

const docClient = DynamoDBDocumentClient.from(client);
const TABLE_NAME = 'locations_table';

class LocationRepository {
  async create(locationData) {
    const locationId = locationData.locationId || 'loc_' + crypto.randomBytes(12).toString('hex');

    const location = {
      locationId,
      name: locationData.name || 'Bodega Principal',
      code: locationData.code || 'BOD-01',
      address: locationData.address || locationData.location || 'Sede Principal',
      location: locationData.location || locationData.address || 'Sede Principal',
      isDefault: locationData.isDefault ?? false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await docClient.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: location
    }));

    return location;
  }

  async getAll() {
    const result = await docClient.send(new ScanCommand({
      TableName: TABLE_NAME
    }));

    return result.Items || [];
  }

  async getOne(locationId) {
    const result = await docClient.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: { locationId }
    }));

    return result.Item || null;
  }

  async getDefault() {
    const all = await this.getAll();
    const def = all.find(l => l.isDefault) || all[0];
    if (def) return def;

    // Auto-create default location if none exists
    return await this.create({
      name: 'Bodega Principal',
      code: 'BOD-01',
      location: 'Sede Principal',
      address: 'Sede Principal',
      isDefault: true
    });
  }

  async update(locationId, updates) {
    const updateExpressions = [];
    const expressionValues = {};
    const expressionNames = {};

    Object.entries(updates).forEach(([key, value]) => {
      if (key !== 'locationId') {
        const nameKey = `#${key}`;
        updateExpressions.push(`${nameKey} = :${key}`);
        expressionValues[`:${key}`] = value;
        expressionNames[nameKey] = key;
      }
    });

    updateExpressions.push('#updatedAt = :updatedAt');
    expressionValues[':updatedAt'] = new Date().toISOString();
    expressionNames['#updatedAt'] = 'updatedAt';

    const result = await docClient.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { locationId },
      UpdateExpression: `SET ${updateExpressions.join(', ')}`,
      ExpressionAttributeNames: expressionNames,
      ExpressionAttributeValues: expressionValues,
      ReturnValues: 'ALL_NEW'
    }));

    return result.Attributes;
  }

  async delete(locationId) {
    await docClient.send(new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { locationId }
    }));

    return { message: 'Location deleted successfully' };
  }
}

module.exports = new LocationRepository();
