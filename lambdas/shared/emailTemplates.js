'use strict';

const LOGO_WHITE = 'https://gnfls.s3.us-east-2.amazonaws.com/brand/envi-logo-white.png';
const STORE_URL = process.env.STORE_URL || 'https://envitienda.com';
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || 'admin@envitienda.com';

const BLACK = '#000000';
const CARD = '#0E0E0E';
const LINE = '#222222';
const MUTED = '#8A8A8A';
const WHITE = '#F5F5F5';
const ACCENT = '#C6FF00';
const FONT = "'Helvetica Neue', Helvetica, Arial, sans-serif";

const money = (n) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(n || 0);

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const attributesLabel = (attrs = []) => attrs.map((a) => (a.name ? `${a.name} ${a.value}` : a.value)).join(' / ');

const firstName = (name) => (name ? String(name).trim().split(/\s+/)[0] : '');

function layout({ preheader, title, body }) {
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark">
  <title>${escapeHtml(title)}</title>
</head>
<body bgcolor="${BLACK}" style="margin:0;padding:0;background:${BLACK};font-family:${FONT};color:${WHITE};-webkit-font-smoothing:antialiased;">
  <span style="display:none;max-height:0;overflow:hidden;opacity:0;color:${BLACK};">${escapeHtml(preheader)}</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${BLACK}" style="background:${BLACK};">
    <tr>
      <td align="center" style="padding:28px 12px 40px 12px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;">
          <tr>
            <td style="padding:0 4px 28px 4px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="left"><img src="${LOGO_WHITE}" alt="ENVI" width="96" style="display:block;width:96px;height:auto;border:0;"></td>
                  <td align="right" style="font-size:11px;letter-spacing:2px;color:${MUTED};text-transform:uppercase;">Premium Apparel</td>
                </tr>
              </table>
            </td>
          </tr>
          ${body}
          <tr>
            <td style="padding:36px 4px 0 4px;border-top:1px solid ${LINE};font-size:11px;line-height:18px;color:${MUTED};letter-spacing:0.3px;">
              ¿Necesitas ayuda? <a href="mailto:${escapeHtml(SUPPORT_EMAIL)}" style="color:${WHITE};text-decoration:none;">${escapeHtml(SUPPORT_EMAIL)}</a><br>
              © ${new Date().getFullYear()} ENVI — Premium Apparel 2026
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

const hero = (kicker, headline) => `
  <tr>
    <td style="padding:8px 4px 0 4px;">
      <div style="font-size:11px;letter-spacing:3px;text-transform:uppercase;color:${ACCENT};font-weight:bold;">${escapeHtml(kicker)}</div>
      <h1 style="margin:14px 0 0 0;font-size:44px;line-height:1;font-weight:900;letter-spacing:-1.5px;text-transform:uppercase;color:${WHITE};">${headline}</h1>
    </td>
  </tr>`;

const paragraph = (html) => `
  <tr>
    <td style="padding:18px 4px 0 4px;font-size:15px;line-height:24px;color:#BDBDBD;">${html}</td>
  </tr>`;

const spacer = (h = 28) => `<tr><td style="height:${h}px;line-height:${h}px;font-size:0;">&nbsp;</td></tr>`;

const button = (href, label) => `
  <tr>
    <td align="left" style="padding:28px 4px 0 4px;">
      <table role="presentation" cellpadding="0" cellspacing="0">
        <tr>
          <td bgcolor="${ACCENT}" style="background:${ACCENT};border-radius:100px;">
            <a href="${escapeHtml(href)}" style="display:inline-block;padding:17px 36px;font-family:${FONT};font-size:13px;font-weight:900;letter-spacing:2px;text-transform:uppercase;color:${BLACK};text-decoration:none;">${escapeHtml(label)} &rarr;</a>
          </td>
        </tr>
      </table>
    </td>
  </tr>`;

const productThumb = (image) => (image
  ? `<img src="${escapeHtml(image)}" alt="" width="72" height="72" style="display:block;width:72px;height:72px;object-fit:cover;border-radius:12px;border:0;background:#1A1A1A;">`
  : `<div style="width:72px;height:72px;border-radius:12px;background:#1A1A1A;"></div>`);

const itemsCard = (items) => `
  <tr>
    <td style="padding:24px 0 0 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${CARD}" style="background:${CARD};border:1px solid ${LINE};border-radius:20px;">
        ${items.map((item) => `
        <tr>
          <td width="88" style="padding:18px 0 18px 18px;">${productThumb(item.image)}</td>
          <td style="padding:18px 12px;">
            <div style="font-size:15px;font-weight:bold;color:${WHITE};">${escapeHtml(item.name)}</div>
            <div style="font-size:12px;color:${MUTED};margin-top:4px;">${escapeHtml(attributesLabel(item.attributes))}${item.quantity ? ` · ×${escapeHtml(item.quantity)}` : ''}</div>
          </td>
          <td align="right" style="padding:18px 20px 18px 0;font-size:15px;font-weight:bold;color:${WHITE};white-space:nowrap;">${money(item.subtotal)}</td>
        </tr>`).join('')}
      </table>
    </td>
  </tr>`;

const totalsBlock = ({ subtotal, shippingFee, totalAmount, balanceDue }) => `
  <tr>
    <td style="padding:20px 4px 0 4px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;color:${MUTED};">
        <tr><td style="padding:5px 0;">Subtotal</td><td align="right" style="padding:5px 0;color:${WHITE};">${money(subtotal)}</td></tr>
        <tr><td style="padding:5px 0;">Envío</td><td align="right" style="padding:5px 0;color:${shippingFee ? WHITE : ACCENT};">${shippingFee ? money(shippingFee) : 'Gratis'}</td></tr>
      </table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;border-top:1px solid ${LINE};">
        <tr><td style="padding:16px 0 0 0;font-size:12px;letter-spacing:2px;text-transform:uppercase;color:${MUTED};">Total</td><td align="right" style="padding:16px 0 0 0;font-size:30px;font-weight:900;letter-spacing:-1px;color:${WHITE};">${money(totalAmount)}</td></tr>
        ${balanceDue > 0 ? `<tr><td style="padding:8px 0 0 0;font-size:12px;color:${MUTED};">Saldo pendiente</td><td align="right" style="padding:8px 0 0 0;font-size:14px;font-weight:bold;color:${ACCENT};">${money(balanceDue)}</td></tr>` : ''}
      </table>
    </td>
  </tr>`;

const STEPS = ['Confirmado', 'Preparando', 'Enviado', 'Entregado'];
const STEP_INDEX = { PENDING: 0, PREPARING: 1, SHIPPED: 2, DELIVERED: 3 };

const progressBar = (currentIndex) => {
  const cells = STEPS.map((label, i) => {
    const done = i <= currentIndex;
    return `
      <td width="25%" style="padding:0 3px;">
        <div style="height:6px;border-radius:6px;background:${done ? ACCENT : '#262626'};"></div>
        <div style="margin-top:10px;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:${done ? WHITE : '#555555'};font-weight:${i === currentIndex ? 'bold' : 'normal'};">${label}</div>
      </td>`;
  }).join('');
  return `
  <tr>
    <td style="padding:28px 4px 0 4px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 -3px;"><tr>${cells}</tr></table>
    </td>
  </tr>`;
};

function orderConfirmation({ customerName, saleId, receiptNumber, items, subtotal, shippingFee, totalAmount, balanceDue, orderUrl }) {
  const body = [
    hero('Pedido confirmado', `Gracias,<br>${escapeHtml(firstName(customerName) || 'campeón')}.`),
    paragraph(`Tu pedido <strong style="color:${WHITE};">${escapeHtml(saleId)}</strong> ya está en marcha. Adjuntamos tu comprobante${receiptNumber ? ` <strong style="color:${WHITE};">${escapeHtml(receiptNumber)}</strong>` : ''}.`),
    progressBar(0),
    itemsCard(items),
    totalsBlock({ subtotal, shippingFee, totalAmount, balanceDue }),
    button(orderUrl, 'Ver mi pedido'),
    spacer(8)
  ].join('');
  return {
    subject: `Pedido confirmado · ${saleId}`,
    html: layout({ preheader: 'Tu pedido está confirmado. Aquí tienes el resumen.', title: 'Pedido confirmado', body })
  };
}

const STATUS_COPY = {
  PREPARING: { kicker: 'Preparando', title: 'Lo estamos<br>empacando', text: 'Tu pedido está en preparación. Lo cuidamos como si fuera nuestro.' },
  SHIPPED: { kicker: 'En camino', title: 'Ya va<br>para ti', text: 'Tu pedido salió de nuestra bodega. Prepárate.' },
  DELIVERED: { kicker: 'Entregado', title: 'Llegó.<br>Disfrútalo', text: 'Tu pedido fue entregado. Gracias por elegirnos.' },
  CANCELLED: { kicker: 'Cancelado', title: 'Pedido<br>cancelado', text: 'Tu pedido fue cancelado. Si tienes dudas, escríbenos.' }
};

function statusUpdate({ customerName, saleId, status, note, orderUrl }) {
  const copy = STATUS_COPY[status];
  if (!copy) throw new Error(`Sin plantilla para el estado ${status}`);
  const body = [
    hero(copy.kicker, copy.title),
    paragraph(`${escapeHtml(copy.text)}<br><span style="color:${MUTED};font-size:13px;">Pedido ${escapeHtml(saleId)}</span>`),
    STEP_INDEX[status] !== undefined && status !== 'CANCELLED' ? progressBar(STEP_INDEX[status]) : '',
    note ? `<tr><td style="padding:24px 4px 0 4px;"><div style="background:${CARD};border:1px solid ${LINE};border-left:3px solid ${ACCENT};border-radius:14px;padding:16px 18px;font-size:14px;line-height:22px;color:${WHITE};">${escapeHtml(note)}</div></td></tr>` : '',
    button(orderUrl, 'Ver seguimiento'),
    spacer(8)
  ].join('');
  return {
    subject: `${copy.kicker} · ${saleId}`,
    html: layout({ preheader: copy.text, title: copy.kicker, body })
  };
}

function reviewInvitation({ customerName, saleId, lines, reviewUrls }) {
  const rows = lines.map((line, i) => `
    <tr>
      <td width="88" style="padding:16px 0 16px 18px;">${productThumb(line.image)}</td>
      <td style="padding:16px 12px;">
        <div style="font-size:15px;font-weight:bold;color:${WHITE};">${escapeHtml(line.name)}</div>
        <div style="font-size:12px;color:${MUTED};margin-top:4px;">${escapeHtml(attributesLabel(line.attributes))}</div>
      </td>
      <td align="right" style="padding:16px 20px 16px 0;">
        <a href="${escapeHtml(reviewUrls[i])}" style="display:inline-block;padding:10px 16px;border:1px solid ${ACCENT};border-radius:100px;font-size:11px;font-weight:bold;letter-spacing:1.5px;text-transform:uppercase;color:${ACCENT};text-decoration:none;white-space:nowrap;">Reseñar</a>
      </td>
    </tr>`).join('');
  const body = [
    hero('Tu opinión importa', `¿Qué tal<br>te queda?`),
    paragraph(`Tu pedido <strong style="color:${WHITE};">${escapeHtml(saleId)}</strong> ya llegó. Cuéntanos cómo te fue y sube una foto si quieres. Cada reseña es de una compra verificada.`),
    `<tr><td style="padding:24px 0 0 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${CARD}" style="background:${CARD};border:1px solid ${LINE};border-radius:20px;">${rows}</table></td></tr>`,
    spacer(8)
  ].join('');
  return {
    subject: '¿Qué tal te queda tu compra?',
    html: layout({ preheader: 'Cuéntanos cómo te fue con tu compra.', title: 'Tu opinión', body })
  };
}

function welcome({ customerName }) {
  const body = [
    hero('Bienvenido', `Hola,<br>${escapeHtml(firstName(customerName) || 'bienvenido')}.`),
    paragraph('Tu cuenta ya está lista. Compra, sigue tus pedidos y deja tu opinión sobre lo que te llevas.'),
    button(STORE_URL, 'Ir a la tienda'),
    spacer(8)
  ].join('');
  return {
    subject: 'Bienvenido a ENVI',
    html: layout({ preheader: 'Tu cuenta ya está lista.', title: 'Bienvenido a ENVI', body })
  };
}

function passwordReset({ customerName, resetUrl, minutes = 30 }) {
  const body = [
    hero('Seguridad', `Nueva<br>contraseña.`),
    paragraph(`${escapeHtml(firstName(customerName) ? `Hola ${firstName(customerName)}, ` : '')}recibimos una solicitud para cambiar tu contraseña. El enlace vence en ${escapeHtml(minutes)} minutos.`),
    button(resetUrl, 'Crear contraseña'),
    paragraph(`<span style="font-size:12px;color:${MUTED};">Si no fuiste tú, ignora este correo. Tu contraseña no cambiará.</span>`),
    spacer(8)
  ].join('');
  return {
    subject: 'Restablece tu contraseña de ENVI',
    html: layout({ preheader: 'Enlace para crear una nueva contraseña.', title: 'Restablecer contraseña', body })
  };
}

module.exports = { orderConfirmation, statusUpdate, reviewInvitation, welcome, passwordReset, escapeHtml, money };
