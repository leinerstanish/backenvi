'use strict';

const nodemailer = require('nodemailer');

let transporter = null;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.MAIL_HOST || 'smtp.gmail.com',
      port: Number(process.env.MAIL_PORT || 587),
      secure: false,
      auth: { user: process.env.MAIL_USER, pass: process.env.MAIL_PASS }
    });
  }
  return transporter;
}

async function sendMail({ to, subject, html, attachments = [], replyTo }) {
  if (!process.env.MAIL_PASS) {
    throw new Error('MAIL_PASS no está configurado');
  }
  return getTransporter().sendMail({
    from: process.env.MAIL_FROM || 'ENVI <admin@envitienda.com>',
    to,
    subject,
    html,
    attachments,
    replyTo: replyTo || process.env.MAIL_USER
  });
}

module.exports = { sendMail };
