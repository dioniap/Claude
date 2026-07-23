import crypto from "node:crypto";
import express from "express";
import { config } from "../config.js";
import { handleHumanEcho, handleIncomingMessage } from "../conversation.js";

export const webhookRouter = express.Router();

/**
 * Verificacao do webhook (Meta chama uma vez ao configurar).
 */
webhookRouter.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === config.whatsapp.verifyToken) {
    console.log("[webhook] verificado com sucesso");
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

/**
 * Valida a assinatura X-Hub-Signature-256 quando WHATSAPP_APP_SECRET esta configurado.
 * (req.rawBody e preenchido no server.js via express.json({ verify }).)
 */
function signatureOk(req) {
  if (!config.whatsapp.appSecret) return true;
  const signature = req.get("x-hub-signature-256") || "";
  if (!req.rawBody) return false;
  const expected =
    "sha256=" +
    crypto
      .createHmac("sha256", config.whatsapp.appSecret)
      .update(req.rawBody)
      .digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

/**
 * Recebimento de eventos do WhatsApp (mensagens dos leads, statuses, echoes).
 * Sempre responde 200 rapido; o processamento e assincrono.
 */
webhookRouter.post("/webhook", (req, res) => {
  if (!signatureOk(req)) {
    console.warn("[webhook] assinatura invalida - evento descartado");
    return res.sendStatus(403);
  }
  res.sendStatus(200);

  const body = req.body;
  if (body?.object !== "whatsapp_business_account") return;

  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};

      // Mensagens recebidas dos leads
      for (const message of value.messages || []) {
        const contact = (value.contacts || []).find(
          (c) => c.wa_id === message.from
        );
        handleIncomingMessage(message, contact).catch((e) =>
          console.error("[webhook] erro ao processar mensagem:", e)
        );
      }

      // Coexistencia: mensagens enviadas manualmente pelo app do celular chegam
      // como echoes — usamos para pausar a IA quando o Dioni assume a conversa.
      const echoes =
        value.message_echoes || value.smb_message_echoes || [];
      for (const echo of echoes) {
        try {
          handleHumanEcho(echo);
        } catch (e) {
          console.error("[webhook] erro ao processar echo:", e);
        }
      }

      // Statuses (entregue/lido/falha) — apenas log de falhas
      for (const status of value.statuses || []) {
        if (status.status === "failed") {
          console.warn(
            `[webhook] envio falhou para ${status.recipient_id}:`,
            JSON.stringify(status.errors || [])
          );
        }
      }
    }
  }
});
