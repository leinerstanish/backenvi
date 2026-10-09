"use strict";

const crypto = require("crypto");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  PutCommand,
  ScanCommand,
  GetCommand,
  UpdateCommand,
  DeleteCommand,
} = require("@aws-sdk/lib-dynamodb");

const client = new DynamoDBClient({
  region: process.env.AWS_REGION || "us-east-1",
});

const docClient = DynamoDBDocumentClient.from(client);
const TABLE_NAME = "users_table";

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto
    .pbkdf2Sync(password, salt, 1000, 64, "sha512")
    .toString("hex");
  return { salt, hash };
}

function verifyPassword(password, hash, salt) {
  const hashedPassword = crypto
    .pbkdf2Sync(password, salt, 1000, 64, "sha512")
    .toString("hex");
  return hashedPassword === hash;
}

class UserRepository {
  async create(userData) {
    const userId = "usr_" + crypto.randomBytes(12).toString("hex");
    const { hash, salt } = hashPassword(userData.password);

    const user = {
      userId,
      email: userData.email,
      firstName: userData.firstName || "",
      lastName: userData.lastName || "",
      passwordHash: hash,
      salt: salt,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await docClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: user,
      }),
    );

    const { passwordHash, salt: _, ...safe } = user;
    return safe;
  }

  async getAll() {
    const result = await docClient.send(
      new ScanCommand({
        TableName: TABLE_NAME,
      }),
    );

    return (result.Items || []).map((user) => {
      const { passwordHash, salt, ...safe } = user;
      return safe;
    });
  }

  async getOne(userId) {
    const result = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { userId },
      }),
    );

    if (!result.Item) return null;

    const { passwordHash, salt, ...safe } = result.Item;
    return safe;
  }

  async update(userId, updates) {
    const { passwordHash, salt, ...safeUpdates } = updates;

    if (Object.keys(safeUpdates).length === 0) {
      return this.getOne(userId);
    }

    const updateExpressions = [];
    const expressionValues = {};
    const expressionNames = {};

    Object.entries(safeUpdates).forEach(([key, value]) => {
      if (key !== "userId" && value !== null && value !== undefined) {
        updateExpressions.push(`#${key} = :${key}`);
        expressionNames[`#${key}`] = key;
        expressionValues[`:${key}`] = value;
      }
    });

    if (updateExpressions.length === 0) {
      return this.getOne(userId);
    }

    updateExpressions.push("#updatedAt = :updatedAt");
    expressionNames["#updatedAt"] = "updatedAt";
    expressionValues[":updatedAt"] = new Date().toISOString();

    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { userId },
        UpdateExpression: `SET ${updateExpressions.join(", ")}`,
        ExpressionAttributeNames: expressionNames,
        ExpressionAttributeValues: expressionValues,
      }),
    );

    return this.getOne(userId);
  }

  async delete(userId) {
    await docClient.send(
      new DeleteCommand({
        TableName: TABLE_NAME,
        Key: { userId },
      }),
    );

    return true;
  }

  async findByEmail(email) {
    const result = await docClient.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: "email = :email",
        ExpressionAttributeValues: { ":email": email },
      }),
    );

    return result.Items && result.Items.length > 0 ? result.Items[0] : null;
  }

  verifyPassword(password, hash, salt) {
    return verifyPassword(password, hash, salt);
  }
}

module.exports = new UserRepository();
