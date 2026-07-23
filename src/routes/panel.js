import express from "express";
import { requireUser } from "../auth.js";
import {
  assignConversation,
  getHistory,
  getLead,
  getInternalThread,
  getUnreadInternalCounts,
  listConversationsForPanel,
  listUsers,
  returnConversationToIA,
  saveInternalMessage,
  saveMessage,
  setConversationStatus,
} from "../db.js";
import { normalizePhone, sendText } from "../whatsapp.js";
import {
  downloadDocumento,
  gclickEnabled,
  getSolicitacao,
  listDocumentos,
  listSolicitacoes,
} from "../gclick.js";

export const panelRouter = express.Router();
panelRouter.use(requireUser);

// ---------- usuarios ----------
panelRouter.get("/users", (req, res) => {
  res.json(listUsers());
});

// ---------- conversas ----------
/** ?filter=ia | user:<id> | all */
panelRouter.get("/conversations", (req, res) => {
  res.json(listConversationsForPanel(req.query.filter || "all"));
});

panelRouter.get("/conversations/:phone/messages", (req, res) => {
  const phone = normalizePhone(req.params.phone);
  res.json({
    lead: getLead(phone) || null,
    messages: getHistory(phone, 300),
  });
});

/** Assumir o atendimento (a IA para de responder este lead). */
panelRouter.post("/conversations/:phone/assume", (req, res) => {
  const phone = normalizePhone(req.params.phone);
  assignConversation(phone, req.user.id);
  saveMessage({
    phone,
    role: "system",
    sender: req.user.name,
    content: `[${req.user.name} assumiu o atendimento]`,
  });
  res.json({ phone, assignedTo: req.user.id, status: "humana" });
});

/** Devolver o atendimento para a IA (limpa atribuicao e pausas). */
panelRouter.post("/conversations/:phone/return-to-ia", (req, res) => {
  const phone = normalizePhone(req.params.phone);
  returnConversationToIA(phone);
  saveMessage({
    phone,
    role: "system",
    sender: req.user.name,
    content: `[${req.user.name} devolveu o atendimento para a IA]`,
  });
  res.json({ phone, status: "ativa" });
});

/** Pausar a IA sem assumir (ex.: caso sensivel aguardando decisao). */
panelRouter.post("/conversations/:phone/pause", (req, res) => {
  const phone = normalizePhone(req.params.phone);
  setConversationStatus(phone, "pausada");
  res.json({ phone, status: "pausada" });
});

/** Enviar mensagem ao lead como atendente humano (pela API oficial). */
panelRouter.post("/conversations/:phone/send", async (req, res) => {
  const phone = normalizePhone(req.params.phone);
  const { text } = req.body || {};
  if (!text || !String(text).trim()) {
    return res.status(400).json({ error: "informe o texto da mensagem" });
  }
  try {
    await sendText(phone, String(text).trim());
  } catch (e) {
    return res.status(502).json({
      error: `falha ao enviar pelo WhatsApp: ${e.message}`,
      hint: "fora da janela de 24h a Meta só aceita template aprovado",
    });
  }
  saveMessage({
    phone,
    role: "assistant",
    sender: req.user.name,
    content: String(text).trim(),
  });
  res.json({ ok: true });
});

// ---------- chat interno ----------
panelRouter.get("/internal/unread", (req, res) => {
  res.json(getUnreadInternalCounts(req.user.id));
});

panelRouter.get("/internal/:userId/messages", (req, res) => {
  const other = parseInt(req.params.userId, 10);
  res.json(getInternalThread(req.user.id, other));
});

panelRouter.post("/internal/:userId/messages", (req, res) => {
  const other = parseInt(req.params.userId, 10);
  const { content } = req.body || {};
  if (!content || !String(content).trim()) {
    return res.status(400).json({ error: "informe o conteúdo" });
  }
  const msg = saveInternalMessage(req.user.id, other, String(content).trim());
  res.json(msg);
});

// ---------- G-Click ----------
panelRouter.get("/gclick/status", (req, res) => {
  res.json({ configured: gclickEnabled() });
});

panelRouter.get("/gclick/solicitacoes", async (req, res) => {
  try {
    const data = await listSolicitacoes({
      cliente: req.query.cliente,
      descricao: req.query.descricao,
      inicioDe: req.query.inicioDe,
      inicioAte: req.query.inicioAte,
      metaDe: req.query.metaDe,
      metaAte: req.query.metaAte,
      vencimentoDe: req.query.vencimentoDe,
      vencimentoAte: req.query.vencimentoAte,
      pagina: req.query.pagina,
    });
    res.json(data);
  } catch (e) {
    res.status(e.notConfigured ? 503 : 502).json({ error: e.message });
  }
});

panelRouter.get("/gclick/solicitacoes/:id", async (req, res) => {
  try {
    res.json(await getSolicitacao(req.params.id));
  } catch (e) {
    res.status(e.notConfigured ? 503 : 502).json({ error: e.message });
  }
});

panelRouter.get("/gclick/solicitacoes/:id/documentos", async (req, res) => {
  try {
    res.json(await listDocumentos(req.params.id));
  } catch (e) {
    res.status(e.notConfigured ? 503 : 502).json({ error: e.message });
  }
});

panelRouter.get(
  "/gclick/solicitacoes/:id/documentos/:anexoId/download",
  async (req, res) => {
    try {
      const upstream = await downloadDocumento(req.params.id, req.params.anexoId);
      res.setHeader(
        "Content-Type",
        upstream.headers.get("content-type") || "application/octet-stream"
      );
      const disposition = upstream.headers.get("content-disposition");
      if (disposition) res.setHeader("Content-Disposition", disposition);
      const buffer = Buffer.from(await upstream.arrayBuffer());
      res.send(buffer);
    } catch (e) {
      res.status(e.notConfigured ? 503 : 502).json({ error: e.message });
    }
  }
);
