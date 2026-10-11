'use strict';

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, ScanCommand, GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({
  region: process.env.AWS_REGION || 'us-east-1'
});

const docClient = DynamoDBDocumentClient.from(client);
const TABLE_NAME = 'reviews_table';

/** Promedio con un decimal y número de reseñas. */
function ratingSummary(reviews) {
  if (reviews.length === 0) return { average: 0, count: 0 };
  const total = reviews.reduce((sum, r) => sum + r.rating, 0);
  return { average: Math.round((total / reviews.length) * 10) / 10, count: reviews.length };
}

class ReviewRepository {
  async create(review) {
    const record = { ...review, status: 'PENDING', createdAt: new Date().toISOString() };

    await docClient.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: record,
      ConditionExpression: 'attribute_not_exists(reviewId)'
    }));

    return record;
  }

  async getOne(reviewId) {
    const result = await docClient.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: { reviewId }
    }));
    return result.Item || null;
  }

  async getAll() {
    const result = await docClient.send(new ScanCommand({ TableName: TABLE_NAME }));
    return result.Items || [];
  }

  async getApprovedByProduct(productId) {
    const result = await docClient.send(new ScanCommand({
      TableName: TABLE_NAME,
      FilterExpression: 'productId = :p AND #s = :approved',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':p': productId, ':approved': 'APPROVED' }
    }));
    return result.Items || [];
  }

  /** Map productId -> { average, count } con las reseñas aprobadas. */
  async approvedSummaryByProduct() {
    const result = await docClient.send(new ScanCommand({
      TableName: TABLE_NAME,
      FilterExpression: '#s = :approved',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':approved': 'APPROVED' }
    }));

    const byProduct = new Map();
    for (const review of result.Items || []) {
      if (!byProduct.has(review.productId)) byProduct.set(review.productId, []);
      byProduct.get(review.productId).push(review);
    }
    return new Map([...byProduct].map(([productId, reviews]) => [productId, ratingSummary(reviews)]));
  }

  async setStatus(reviewId, status) {
    const result = await docClient.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { reviewId },
      UpdateExpression: 'SET #s = :s, #u = :u',
      ConditionExpression: 'attribute_exists(reviewId)',
      ExpressionAttributeNames: { '#s': 'status', '#u': 'updatedAt' },
      ExpressionAttributeValues: { ':s': status, ':u': new Date().toISOString() },
      ReturnValues: 'ALL_NEW'
    }));
    return result.Attributes;
  }
}

module.exports = new ReviewRepository();
module.exports.ratingSummary = ratingSummary;
