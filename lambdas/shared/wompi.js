'use strict';

const crypto = require('crypto');

const CURRENCY = 'COP';
// Separa el saleId del sufijo de cada intento de pago: "sale_abc123-lq9x2k".
const REFERENCE_SEPARATOR = '-';

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

function config() {
  const publicKey = process.env.WOMPI_PUBLIC_KEY;
  const integritySecret = process.env.WOMPI_INTEGRITY_SECRET;
  const eventsSecret = process.env.WOMPI_EVENTS_SECRET;
  if (!publicKey || !integritySecret || !eventsSecret) {
    throw new Error('Faltan las llaves de Wompi (WOMPI_PUBLIC_KEY, WOMPI_INTEGRITY_SECRET, WOMPI_EVENTS_SECRET)');
  }
  // El ambiente sale de la llave para que llave y URL nunca queden cruzadas.
  const apiUrl = publicKey.startsWith('pub_prod_')
    ? 'https://production.wompi.co/v1'
    : 'https://sandbox.wompi.co/v1';
  return { publicKey, integritySecret, eventsSecret, apiUrl };
}

function newReference(saleId) {
  return `${saleId}${REFERENCE_SEPARATOR}${Date.now().toString(36)}`;
}

function saleIdFromReference(reference) {
  const value = String(reference || '');
  const cut = value.lastIndexOf(REFERENCE_SEPARATOR);
  return cut > 0 ? value.slice(0, cut) : null;
}

const toCents = (amount) => Math.round(Number(amount) * 100);

/** Parámetros del Web Checkout / Widget, con la firma de integridad que impide cambiar monto o referencia. */
function checkoutSession({ saleId, amount, redirectUrl, customer }) {
  const { publicKey, integritySecret } = config();
  const reference = newReference(saleId);
  const amountInCents = toCents(amount);
  const signature = sha256(`${reference}${amountInCents}${CURRENCY}${integritySecret}`);

  return {
    publicKey,
    currency: CURRENCY,
    amountInCents,
    reference,
    signature,
    redirectUrl,
    customerData: customer ? {
      email: customer.email || undefined,
      fullName: customer.name || undefined,
      phoneNumber: customer.phone ? String(customer.phone).replace(/\D/g, '').slice(-10) : undefined,
      phoneNumberPrefix: customer.phone ? '+57' : undefined
    } : undefined
  };
}

const getPath = (obj, path) => path.split('.').reduce((acc, key) => (acc == null ? acc : acc[key]), obj);

/** Valida el checksum de un evento de Wompi: SHA256(valores de signature.properties + timestamp + secreto de eventos). */
function isValidEvent(body) {
  const { eventsSecret } = config();
  const properties = body?.signature?.properties;
  const checksum = String(body?.signature?.checksum || '').toLowerCase();
  if (!Array.isArray(properties) || !checksum || body.timestamp == null) return false;

  const values = properties.map((path) => getPath(body.data, path)).join('');
  const expected = sha256(`${values}${body.timestamp}${eventsSecret}`);
  return expected.length === checksum.length
    && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(checksum));
}

/** Consulta una transacción directamente en Wompi (fuente confiable, no depende del navegador). */
async function fetchTransaction(transactionId) {
  const { apiUrl, publicKey } = config();
  const res = await fetch(`${apiUrl}/transactions/${encodeURIComponent(transactionId)}`, {
    headers: { Authorization: `Bearer ${publicKey}` }
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Wompi respondió HTTP ${res.status}`);
  const json = await res.json();
  return json.data || null;
}

module.exports = { CURRENCY, toCents, checkoutSession, saleIdFromReference, isValidEvent, fetchTransaction };
