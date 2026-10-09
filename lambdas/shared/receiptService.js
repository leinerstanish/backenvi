'use strict';

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const saleRepository = require('./saleRepository');
const clientRepository = require('./clientRepository');
const paymentRepository = require('./paymentRepository');

const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' }));
const s3 = new S3Client({ region: process.env.RECEIPTS_REGION || 'us-east-2' });

const COUNTERS_TABLE = 'counters_table';
const LOGO_WHITE_URL = 'https://gnfls.s3.us-east-2.amazonaws.com/brand/envi-logo-white.png';
const LOGO_WHITE_FALLBACK = path.join(__dirname, '..', '..', 'assets', 'receipt-logo-white.png');
const URL_TTL_SECONDS = 3600;
const STORE_URL = process.env.STORE_URL || 'https://envitienda.com';

const BLACK = '#000000';
const LIME = '#C6FF00';
const INK = '#111111';
const MUTED = '#777777';
const LINE = '#E6E6E6';

const money = (n) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(n || 0);

async function nextReceiptNumber() {
  const result = await docClient.send(new UpdateCommand({
    TableName: COUNTERS_TABLE,
    Key: { counterId: 'receipt' },
    UpdateExpression: 'ADD #v :one',
    ExpressionAttributeNames: { '#v': 'value' },
    ExpressionAttributeValues: { ':one': 1 },
    ReturnValues: 'UPDATED_NEW'
  }));
  return `CV-${String(result.Attributes.value).padStart(6, '0')}`;
}

async function loadWhiteLogo() {
  try {
    const res = await fetch(LOGO_WHITE_URL);
    if (!res.ok) throw new Error(`logo HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  } catch (error) {
    console.warn('Using bundled white logo:', error.message);
    return fs.readFileSync(LOGO_WHITE_FALLBACK);
  }
}

function renderPdf({ sale, receiptNumber, client, totalPaid, logo, qr }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const dateText = new Date(sale.createdAt).toLocaleDateString('es-CO', { day: '2-digit', month: 'long', year: 'numeric' });
    const companyNit = process.env.RECEIPT_COMPANY_NIT || '';
    const left = 48;
    const right = 547;

    doc.rect(0, 0, 595, 168).fill(BLACK);
    doc.image(logo, left, 46, { height: 62 });
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(26)
      .text('COMPROBANTE', 300, 52, { align: 'right', width: right - 300, characterSpacing: -0.5 });
    doc.fillColor(LIME).font('Helvetica-Bold').fontSize(11)
      .text(receiptNumber, 300, 90, { align: 'right', width: right - 300, characterSpacing: 1 });
    doc.fillColor('#9A9A9A').font('Helvetica').fontSize(10)
      .text(dateText, 300, 108, { align: 'right', width: right - 300 });
    doc.rect(0, 168, 595, 5).fill(LIME);

    let y = 206;
    doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(8).text('PEDIDO', left, y, { characterSpacing: 2 });
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(11).text(sale.saleId, left, y + 14, { width: 240 });
    doc.fillColor(MUTED).font('Helvetica').fontSize(9).text(`Tipo de venta: ${sale.saleType === 'CREDIT' ? 'Crédito' : 'Contado'}`, left, y + 36);

    doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(8).text('CLIENTE', 320, y, { characterSpacing: 2 });
    const clientLines = client
      ? [client.name, client.documentId ? `Doc. ${client.documentId}` : null, client.phone ? `Tel. ${client.phone}` : null, client.email || null].filter(Boolean)
      : ['Cliente general'];
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(11).text(clientLines[0], 320, y + 14, { width: 227 });
    doc.fillColor(MUTED).font('Helvetica').fontSize(9).text(clientLines.slice(1).join('\n'), 320, y + 32, { width: 227 });

    y = 300;
    doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(8).text('PRODUCTOS', left, y, { characterSpacing: 2 });
    doc.fillColor(MUTED).text('CANT.', 380, y, { width: 40, align: 'right', characterSpacing: 2 })
      .text('PRECIO', 425, y, { width: 55, align: 'right', characterSpacing: 2 })
      .text('SUBTOTAL', 485, y, { width: 62, align: 'right', characterSpacing: 2 });
    y += 18;
    doc.moveTo(left, y).lineTo(right, y).strokeColor(INK).lineWidth(1).stroke();
    y += 12;

    for (const item of sale.items || []) {
      if (y > 640) {
        doc.addPage({ size: 'A4', margin: 0 });
        y = 60;
      }
      const attrs = (item.attributes || []).map((a) => (a.name ? `${a.name} ${a.value}` : a.value)).join(' · ');
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(11).text(item.name || '', left, y, { width: 290 });
      const nameHeight = doc.heightOfString(item.name || '', { width: 290 });
      if (attrs) {
        doc.fillColor(MUTED).font('Helvetica').fontSize(9).text(attrs, left, y + nameHeight + 2, { width: 290 });
      }
      const attrsHeight = attrs ? doc.heightOfString(attrs, { width: 290 }) + 2 : 0;
      doc.fillColor(INK).font('Helvetica').fontSize(10)
        .text(String(item.quantity), 380, y, { width: 40, align: 'right' })
        .text(money(item.price), 425, y, { width: 55, align: 'right' })
        .text(money(item.subtotal), 485, y, { width: 62, align: 'right' });
      y += nameHeight + attrsHeight + 14;
      doc.moveTo(left, y - 6).lineTo(right, y - 6).strokeColor(LINE).lineWidth(0.5).stroke();
    }

    const boxTop = Math.max(y + 10, 470);
    if (boxTop > 640) {
      doc.addPage({ size: 'A4', margin: 0 });
    }
    const top = boxTop > 640 ? 80 : boxTop;

    doc.rect(318, top, 229, 166).fill(BLACK);
    const row = (label, value, yy, opts = {}) => {
      doc.fillColor(opts.color || '#BDBDBD').font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(opts.size || 10)
        .text(label, 336, yy, { width: 120 })
        .text(value, 436, yy, { width: 100, align: 'right' });
    };
    row('Subtotal', money(sale.subtotal), top + 16);
    row('Envío', sale.shippingFee ? money(sale.shippingFee) : 'Gratis', top + 36, { color: sale.shippingFee ? '#BDBDBD' : LIME });
    row('TOTAL', money(sale.totalAmount), top + 60, { color: '#FFFFFF', bold: true, size: 15 });
    row('Pagado', money(totalPaid), top + 92);
    row('Saldo pendiente', money(sale.balanceDue), top + 112, { color: LIME, bold: true });

    doc.image(qr, left, top, { width: 104 });
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(10).text('Sigue tu pedido', left + 118, top + 18, { width: 150 });
    doc.fillColor(MUTED).font('Helvetica').fontSize(9)
      .text('Escanea el código para ver el estado de tu pedido y dejar tu reseña cuando lo recibas.', left + 118, top + 36, { width: 150 });

    const footerY = 800;
    doc.rect(0, footerY, 595, 42).fill(BLACK);
    doc.fillColor('#FFFFFF').font('Helvetica').fontSize(8)
      .text(`ENVI · Premium Apparel 2026${companyNit ? ` · NIT ${companyNit}` : ''}`, left, footerY + 14, { width: 260, characterSpacing: 1 });
    doc.fillColor('#9A9A9A').fontSize(7.5)
      .text('Comprobante de venta interno. No constituye factura electrónica.', 300, footerY + 14, { width: right - 300, align: 'right' });

    doc.end();
  });
}

async function generateReceipt(saleId) {
  const sale = await saleRepository.getOne(saleId);
  if (!sale) return null;

  const client = sale.clientId ? await clientRepository.getOne(sale.clientId).catch(() => null) : null;
  const payments = await paymentRepository.getAll({ saleId });
  const totalPaid = payments.reduce((sum, p) => sum + (p.amount || 0), 0);

  const receiptNumber = sale.receiptNumber || await nextReceiptNumber();
  const logo = await loadWhiteLogo();
  const qr = await QRCode.toBuffer(`${STORE_URL}/pedido/${saleId}`, { width: 300, margin: 1, color: { dark: '#000000', light: '#FFFFFF' } });
  const pdf = await renderPdf({ sale, receiptNumber, client, totalPaid, logo, qr });

  const receiptKey = `receipts/${saleId}.pdf`;
  await s3.send(new PutObjectCommand({
    Bucket: process.env.RECEIPTS_BUCKET,
    Key: receiptKey,
    Body: pdf,
    ContentType: 'application/pdf',
    ServerSideEncryption: 'AES256'
  }));

  await saleRepository.setReceipt(saleId, { receiptNumber, receiptKey });

  return { receiptNumber, receiptKey };
}

async function receiptUrl(receiptKey) {
  return getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: process.env.RECEIPTS_BUCKET, Key: receiptKey }),
    { expiresIn: URL_TTL_SECONDS }
  );
}

module.exports = { generateReceipt, receiptUrl };
