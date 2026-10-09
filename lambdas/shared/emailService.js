'use strict';

const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { sendMail } = require('./mailer');
const templates = require('./emailTemplates');
const saleRepository = require('./saleRepository');
const productRepository = require('./productRepository');
const clientRepository = require('./clientRepository');
const { HttpError } = require('./catalogRules');

const s3 = new S3Client({ region: process.env.RECEIPTS_REGION || 'us-east-2' });
const STORE_URL = process.env.STORE_URL || 'https://envitienda.com';

const TEMPLATE_TYPES = ['orderConfirmation', 'statusUpdate', 'reviewInvitation', 'welcome', 'passwordReset'];

async function sendTemplate(type, to, data = {}, attachments = []) {
  if (!TEMPLATE_TYPES.includes(type)) {
    throw new HttpError(400, `Plantilla desconocida: ${type}`);
  }
  const { subject, html } = templates[type](data);
  return sendMail({ to, subject, html, attachments });
}

async function withProductImages(items = []) {
  const products = await Promise.all(items.map((i) => productRepository.getOne(i.productId).catch(() => null)));
  return items.map((item, i) => ({
    ...item,
    image: products[i] && products[i].images && products[i].images[0] ? products[i].images[0] : null
  }));
}

async function customerOf(sale) {
  if (!sale.clientId) return null;
  const client = await clientRepository.getOne(sale.clientId).catch(() => null);
  return client && client.email ? client : null;
}

async function receiptAttachment(receiptKey, receiptNumber) {
  if (!receiptKey) return [];
  const object = await s3.send(new GetObjectCommand({ Bucket: process.env.RECEIPTS_BUCKET, Key: receiptKey }));
  const buffer = Buffer.from(await object.Body.transformToByteArray());
  return [{ filename: `${receiptNumber || 'comprobante'}.pdf`, content: buffer, contentType: 'application/pdf' }];
}

async function notifyOrderConfirmed(saleId) {
  const sale = await saleRepository.getOne(saleId);
  const client = sale && (await customerOf(sale));
  if (!client) return { sent: false, reason: 'sin correo del cliente' };

  const attachments = await receiptAttachment(sale.receiptKey, sale.receiptNumber);
  await sendTemplate('orderConfirmation', client.email, {
    customerName: client.name,
    saleId,
    receiptNumber: sale.receiptNumber,
    items: await withProductImages(sale.items || []),
    subtotal: sale.subtotal,
    shippingFee: sale.shippingFee,
    totalAmount: sale.totalAmount,
    balanceDue: sale.balanceDue,
    orderUrl: `${STORE_URL}/pedido/${saleId}`
  }, attachments);
  return { sent: true };
}

async function notifyStatusChanged(saleId, status, note) {
  const sale = await saleRepository.getOne(saleId);
  const client = sale && (await customerOf(sale));
  if (!client) return { sent: false, reason: 'sin correo del cliente' };

  await sendTemplate('statusUpdate', client.email, {
    customerName: client.name,
    saleId,
    status,
    note,
    orderUrl: `${STORE_URL}/pedido/${saleId}`
  });
  return { sent: true };
}

async function notifyReviewInvitation(saleId) {
  const sale = await saleRepository.getOne(saleId);
  const client = sale && (await customerOf(sale));
  if (!client) return { sent: false, reason: 'sin correo del cliente' };

  const lines = (await withProductImages(sale.items || [])).filter((i) => i.reviewToken);
  if (lines.length === 0) return { sent: false, reason: 'sin líneas para reseñar' };

  await sendTemplate('reviewInvitation', client.email, {
    customerName: client.name,
    saleId,
    lines,
    reviewUrls: lines.map((l) => `${STORE_URL}/resena/${l.reviewToken}`)
  });
  return { sent: true };
}

module.exports = { sendTemplate, notifyOrderConfirmed, notifyStatusChanged, notifyReviewInvitation, TEMPLATE_TYPES };
