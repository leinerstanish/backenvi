const { DynamoDBClient, CreateTableCommand } = require('@aws-sdk/client-dynamodb');

const fs = require('fs');
if (fs.existsSync('.env')) {
  const envContent = fs.readFileSync('.env', 'utf-8');
  envContent.split('\n').forEach(line => {
    const eq = line.indexOf('=');
    if (eq > 0) {
      const k = line.slice(0, eq).trim();
      const v = line.slice(eq + 1).trim();
      if (!process.env[k]) process.env[k] = v;
    }
  });
}

const client = new DynamoDBClient({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: process.env.AWS_ACCESS_KEY_ID ? {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  } : undefined
});

async function createTable(tableName, keySchema, attributeDefinitions) {
  try {
    console.log(`Creating ${tableName}...`);
    await client.send(new CreateTableCommand({
      TableName: tableName,
      KeySchema: keySchema,
      AttributeDefinitions: attributeDefinitions,
      BillingMode: 'PAY_PER_REQUEST'
    }));
    console.log(`✓ ${tableName} created`);
  } catch (error) {
    if (error.name === 'ResourceInUseException') {
      console.log(`✓ ${tableName} already exists`);
    } else {
      console.error(`Error creating ${tableName}:`, error.message);
      throw error;
    }
  }
}

async function createTables() {
  try {
    await createTable('users_table', [{ AttributeName: 'userId', KeyType: 'HASH' }], [{ AttributeName: 'userId', AttributeType: 'S' }]);
    await createTable('roles_table', [{ AttributeName: 'roleId', KeyType: 'HASH' }], [{ AttributeName: 'roleId', AttributeType: 'S' }]);
    await createTable('categories_table', [{ AttributeName: 'categoryId', KeyType: 'HASH' }], [{ AttributeName: 'categoryId', AttributeType: 'S' }]);
    await createTable('products_table', [{ AttributeName: 'productId', KeyType: 'HASH' }], [{ AttributeName: 'productId', AttributeType: 'S' }]);
    await createTable('attributes_table', [{ AttributeName: 'attributeId', KeyType: 'HASH' }], [{ AttributeName: 'attributeId', AttributeType: 'S' }]);
    await createTable('variants_table', [{ AttributeName: 'variantId', KeyType: 'HASH' }], [{ AttributeName: 'variantId', AttributeType: 'S' }]);
    await createTable('brands_table', [{ AttributeName: 'brandId', KeyType: 'HASH' }], [{ AttributeName: 'brandId', AttributeType: 'S' }]);
    await createTable('locations_table', [{ AttributeName: 'locationId', KeyType: 'HASH' }], [{ AttributeName: 'locationId', AttributeType: 'S' }]);
    await createTable('inventory_table', [{ AttributeName: 'id', KeyType: 'HASH' }], [{ AttributeName: 'id', AttributeType: 'S' }]);
    await createTable('inventory_movements_table', [{ AttributeName: 'movementId', KeyType: 'HASH' }], [{ AttributeName: 'movementId', AttributeType: 'S' }]);

    // POS & Accounts Receivable Tables
    await createTable('clients_table', [{ AttributeName: 'clientId', KeyType: 'HASH' }], [{ AttributeName: 'clientId', AttributeType: 'S' }]);
    await createTable('sales_table', [{ AttributeName: 'saleId', KeyType: 'HASH' }], [{ AttributeName: 'saleId', AttributeType: 'S' }]);
    await createTable('payments_table', [{ AttributeName: 'paymentId', KeyType: 'HASH' }], [{ AttributeName: 'paymentId', AttributeType: 'S' }]);

    // CRM - Cash Management
    await createTable('withdrawals_table', [{ AttributeName: 'withdrawalId', KeyType: 'HASH' }], [{ AttributeName: 'withdrawalId', AttributeType: 'S' }]);

    // Catalog - unique SKU locks (one row per SKU, written in the same transaction as its variant)
    await createTable('sku_locks_table', [{ AttributeName: 'sku', KeyType: 'HASH' }], [{ AttributeName: 'sku', AttributeType: 'S' }]);

    // Counters - consecutive numbers (receipts)
    await createTable('counters_table', [{ AttributeName: 'counterId', KeyType: 'HASH' }], [{ AttributeName: 'counterId', AttributeType: 'S' }]);

    // Reviews - one row per sale line (reviewId = saleId#lineIndex)
    await createTable('reviews_table', [{ AttributeName: 'reviewId', KeyType: 'HASH' }], [{ AttributeName: 'reviewId', AttributeType: 'S' }]);

    console.log('\n✅ All tables ready!');
  } catch (error) {
    process.exit(1);
  }
}

createTables();
