import express from "express";
import multer from "multer";
import * as XLSX from "xlsx";
import { config } from "../config.js";
import { listLeads, upsertLead } from "../db.js";
import {
  enqueueContacts,
  enqueueFromRedrive,
  getDispatchStats,
  isDispatchRunning,
  runDispatchQueue,
  stopDispatchQueue,
} from "../dispatch.js";
import { normalizePhone } from "../whatsapp.js";
import { checkStatus, redriveEnabled } from "../redrive.js";
import { gclickEnabled } from "../gclick.js";
import { requireUserOrAdminToken } from "../auth.js";

export const adminRouter = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// Aceita login do painel (Bearer <token de sessao>) ou ADMIN_TOKEN (scripts)
adminRouter.use(requireUserOrAdminToken);

// ---------- saude ----------
adminRouter.get("/health", async (req, res) => {
  let redriveStatus = "desativado";
  if (redriveEnabled()) {
    try {
      await checkStatus();
      redriveStatus = "ok";
    } catch (e) {
      redriveStatus = `erro: ${e.message}`;
    }
  }
  res.json({
    ok: true,
    model: config.anthropic.model,
    whatsappPhoneNumberId: config.whatsapp.phoneNumberId,
    redrive: redriveStatus,
    gclick: gclickEnabled() ? "configurado" : "nao configurado",
    smtp: config.smtp.user ? "configurado" : "nao configurado",
    dispatchRunning: isDispatchRunning(),
  });
});

// ---------- leads ----------
adminRouter.get("/leads", (req, res) => {
  res.json(listLeads());
});

/** Inclusao manual: { contacts: [{phone, name, email}], dispatch?: true, campaign?: "..." } */
adminRouter.post("/leads", (req, res) => {
  const { contacts, dispatch, campaign } = req.body || {};
  if (!Array.isArray(contacts) || !contacts.length) {
    return res.status(400).json({ error: "envie contacts: [{phone, name?, email?}]" });
  }
  if (dispatch) {
    const result = enqueueContacts(contacts, campaign || "manual", "manual");
    return res.json({ ...result, note: "use POST /api/dispatch/start para iniciar os envios" });
  }
  let added = 0;
  for (const c of contacts) {
    const phone = normalizePhone(c.phone);
    if (!phone) continue;
    upsertLead({ phone, name: c.name, email: c.email, source: "manual" });
    added++;
  }
  res.json({ added });
});

/**
 * Importacao via Excel (.xlsx/.csv). Colunas aceitas (qualquer capitalizacao):
 * telefone/phone/celular/whatsapp, nome/name, email.
 * form-data: file=<arquivo>; query: ?dispatch=1&campaign=nome
 */
adminRouter.post("/leads/excel", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "envie o arquivo no campo 'file'" });
  const wb = XLSX.read(req.file.buffer, { type: "buffer" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

  const contacts = [];
  for (const row of rows) {
    const norm = {};
    for (const [k, v] of Object.entries(row)) norm[k.toLowerCase().trim()] = v;
    const phone =
      norm.telefone || norm.phone || norm.celular || norm.whatsapp || norm.fone || norm.numero;
    const name = norm.nome || norm.name || norm.advogado;
    const email = norm.email || norm["e-mail"];
    if (phone) contacts.push({ phone: String(phone), name: String(name || "").trim() || undefined, email: String(email || "").trim() || undefined });
  }

  if (!contacts.length) {
    return res.status(400).json({
      error: "nenhum contato encontrado. Colunas aceitas: telefone/phone/celular/whatsapp, nome, email",
    });
  }

  const wantDispatch = req.query.dispatch === "1" || req.query.dispatch === "true";
  if (wantDispatch) {
    const result = enqueueContacts(contacts, req.query.campaign || "excel", "excel");
    return res.json({ ...result, note: "use POST /api/dispatch/start para iniciar os envios" });
  }
  let added = 0;
  for (const c of contacts) {
    const phone = normalizePhone(c.phone);
    if (!phone) continue;
    upsertLead({ phone, name: c.name, email: c.email, source: "excel" });
    added++;
  }
  res.json({ added });
});

/** Importa leads do CRM do Redrive e enfileira disparo. Body: { campaign, params? } */
adminRouter.post("/leads/redrive", async (req, res) => {
  try {
    const { campaign, params } = req.body || {};
    const result = await enqueueFromRedrive(campaign || "redrive", params || {});
    res.json({ ...result, note: "use POST /api/dispatch/start para iniciar os envios" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------- disparos ----------
adminRouter.post("/dispatch/start", async (req, res) => {
  const result = await runDispatchQueue();
  res.json(result);
});

adminRouter.post("/dispatch/stop", (req, res) => {
  stopDispatchQueue();
  res.json({ stopping: true });
});

adminRouter.get("/dispatch/stats", (req, res) => {
  res.json({
    running: isDispatchRunning(),
    stats: getDispatchStats(req.query.campaign),
  });
});
