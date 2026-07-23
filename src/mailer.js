import nodemailer from "nodemailer";
import { config } from "./config.js";

let transporter = null;

function getTransporter() {
  if (!config.smtp.user || !config.smtp.pass) {
    throw new Error("SMTP nao configurado (SMTP_USER / SMTP_PASS no .env)");
  }
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: { user: config.smtp.user, pass: config.smtp.pass },
    });
  }
  return transporter;
}

export async function sendTempPasswordEmail(toEmail, userName, tempPassword) {
  const t = getTransporter();
  await t.sendMail({
    from: `"Painel Atende Laudos — Simplifica" <${config.smtp.from}>`,
    to: toEmail,
    subject: "Sua senha provisória — Painel de Atendimento",
    text:
      `Olá, ${userName}!\n\n` +
      `Recebemos um pedido de redefinição de senha do Painel de Atendimento (atende-laudos).\n\n` +
      `Sua senha provisória é: ${tempPassword}\n\n` +
      `Entre com essa senha e o sistema vai pedir para você criar uma nova senha no primeiro acesso.\n\n` +
      `Se você não pediu a redefinição, ignore este e-mail.\n\n` +
      `— Simplifica Contabilidade`,
    html:
      `<p>Olá, <b>${userName}</b>!</p>` +
      `<p>Recebemos um pedido de redefinição de senha do <b>Painel de Atendimento</b> (atende-laudos).</p>` +
      `<p>Sua senha provisória é:</p>` +
      `<p style="font-size:20px;font-weight:bold;letter-spacing:2px;background:#f4f4f4;padding:12px 16px;border-radius:8px;display:inline-block">${tempPassword}</p>` +
      `<p>Entre com essa senha e o sistema vai pedir para você criar uma <b>nova senha</b> no primeiro acesso.</p>` +
      `<p style="color:#888">Se você não pediu a redefinição, ignore este e-mail.</p>` +
      `<p>— Simplifica Contabilidade</p>`,
  });
}
