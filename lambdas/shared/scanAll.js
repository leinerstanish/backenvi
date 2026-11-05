'use strict';

const { ScanCommand } = require('@aws-sdk/lib-dynamodb');

/**
 * Scan que recorre todas las páginas de la tabla. DynamoDB entrega como máximo 1 MB por llamada:
 * un ScanCommand suelto deja de ver los registros siguientes sin avisar cuando la tabla crece
 * (con el catálogo de perfumería, cientos de productos). Devuelve { Items } como docClient.send().
 */
async function scanAll(docClient, input) {
  const Items = [];
  let ExclusiveStartKey;
  do {
    const page = await docClient.send(new ScanCommand({ ...input, ...(ExclusiveStartKey ? { ExclusiveStartKey } : {}) }));
    Items.push(...(page.Items || []));
    ExclusiveStartKey = page.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return { Items, Count: Items.length };
}

module.exports = { scanAll };
