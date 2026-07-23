import { config } from "./config.js";
import {
  dispatchStats,
  markDispatch,
  nextPendingDispatch,
  queueDispatch,
  upsertLead,
  updateLeadStatus,
} from "./db.js";
import { normalizePhone, sendTemplate } from "./whatsapp.js";
import { listContacts, redriveEnabled } from "./redrive.js";

let running = false;
let stopRequested = false;

/**
 * Enfileira contatos para disparo do template aprovado.
 * @param {Array<{phone:string, name?:string, email?:string}>} contacts
 * @param {string} campaign - nome da campanha (para relatorio)
 * @param {string} source - manual | excel | redrive
 * @returns {{queued:number, skipped:number}}
 */
export function enqueueContacts(contacts, campaign, source) {
  let queued = 0;
  let skipped = 0;
  for (const c of contacts) {
    const phone = normalizePhone(c.phone);
    if (!phone) {
      skipped++;
      continue;
    }
    upsertLead({ phone, name: c.name, email: c.email, source });
    queueDispatch({
      campaign,
      phone,
      name: c.name,
      template: config.whatsapp.template.name,
    });
    queued++;
  }
  return { queued, skipped };
}

/**
 * Importa contatos do CRM do Redrive e enfileira o disparo.
 * params: filtros aceitos pelo /v1/crm/contact (createdAtStart, createdAtEnd, ...)
 */
export async function enqueueFromRedrive(campaign, params = {}) {
  if (!redriveEnabled()) throw new Error("REDRIVE_API_TOKEN nao configurado");
  const contacts = [];
  let offset = 0;
  const limit = 100;
  for (let page = 0; page < 50; page++) {
    const result = await listContacts({
      ...params,
      offset: String(offset),
      limit: String(limit),
    });
    const rows = Array.isArray(result) ? result : result?.data || result?.contacts || [];
    if (!rows.length) break;
    for (const r of rows) {
      contacts.push({
        phone: r.mobilephone || r.phone,
        name: r.firstname
          ? `${r.firstname} ${r.lastname || ""}`.trim()
          : r.name,
        email: r.email,
      });
    }
    if (rows.length < limit) break;
    offset += limit;
  }
  return enqueueContacts(contacts, campaign, "redrive");
}

/** Processa a fila de disparos respeitando o intervalo configurado. */
export async function runDispatchQueue() {
  if (running) return { started: false, reason: "ja em execucao" };
  running = true;
  stopRequested = false;

  (async () => {
    console.log("[dispatch] fila iniciada");
    while (!stopRequested) {
      const item = nextPendingDispatch();
      if (!item) break;
      try {
        const result = await sendTemplate(item.phone, { name: firstName(item.name) });
        const waId = result?.messages?.[0]?.id;
        markDispatch(item.id, "enviado", { waMessageId: waId });
        updateLeadStatus(item.phone, "contatado");
      } catch (e) {
        console.error(`[dispatch] erro para ${item.phone}: ${e.message}`);
        markDispatch(item.id, "erro", { error: e.message });
      }
      const jitter = Math.floor(Math.random() * 2000);
      await sleep(config.behavior.dispatchIntervalMs + jitter);
    }
    running = false;
    console.log("[dispatch] fila finalizada");
  })().catch((e) => {
    running = false;
    console.error("[dispatch] fila abortada:", e);
  });

  return { started: true };
}

export function stopDispatchQueue() {
  stopRequested = true;
}

export function isDispatchRunning() {
  return running;
}

export function getDispatchStats(campaign) {
  return dispatchStats(campaign);
}

function firstName(name) {
  if (!name) return undefined;
  return String(name).trim().split(/\s+/)[0];
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
