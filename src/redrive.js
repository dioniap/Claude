import { config } from "./config.js";

/**
 * Cliente da Customer API do Redrive (https://api.redrive.com.br/docs/).
 * Autenticacao: Bearer JWT (REDRIVE_API_TOKEN).
 */
async function redriveRequest(pathSegment, { method = "POST", body } = {}) {
  if (!config.redrive.token) throw new Error("REDRIVE_API_TOKEN nao configurado");
  const res = await fetch(`${config.redrive.baseUrl}${pathSegment}`, {
    method,
    headers: {
      Authorization: `Bearer ${config.redrive.token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Redrive API ${pathSegment}: HTTP ${res.status} ${JSON.stringify(json)}`);
  }
  return json;
}

export function redriveEnabled() {
  return !!config.redrive.token;
}

/** Lista contatos do CRM (paginado). params ex.: { offset, limit, createdAtStart, createdAtEnd } */
export async function listContacts(params = {}) {
  return redriveRequest("/v1/crm/contact", {
    body: { params: { offset: "0", limit: "100", ...params } },
  });
}

export async function getContactByPhone(mobilephone) {
  return redriveRequest("/v1/crm/getbyphone", {
    body: { mobilephone, params: { offset: "0", limit: "10" } },
  });
}

/** Adiciona observacao (follow-up) no lead do Redrive. */
export async function addFollowup(leadId, obs) {
  return redriveRequest("/v1/crm/followup", { body: { leadId, obs } });
}

export async function addTags(leadId, tags) {
  return redriveRequest("/v1/crm/add-tags", { body: { leadId, tags } });
}

export async function markOpportunity(leadId) {
  return redriveRequest("/v1/crm/make-oportunity", { body: { leadId } });
}

export async function markLost(leadId) {
  return redriveRequest("/v1/crm/tag-lost", { body: { leadId } });
}

export async function markClient(leadId) {
  return redriveRequest("/v1/crm/add-client", { body: { leadId } });
}

/** Verificacao simples de conectividade com a API do Redrive. */
export async function checkStatus() {
  return redriveRequest("/status", { body: {} });
}

/**
 * Melhor-esforco: registra o andamento do atendimento no CRM do Redrive.
 * Nunca lanca erro (o atendimento nao pode parar por falha de CRM).
 */
export async function safeLogToRedrive(phone, obs, { tag } = {}) {
  if (!redriveEnabled()) return;
  try {
    const result = await getContactByPhone(phone);
    const contact = Array.isArray(result) ? result[0] : result?.data?.[0] || result?.[0];
    const leadId = contact?.id || contact?.leadId || contact?._id;
    if (!leadId) return;
    await addFollowup(String(leadId), obs);
    if (tag) await addTags(String(leadId), [tag]).catch(() => {});
  } catch (e) {
    console.warn(`[redrive] followup falhou para ${phone}: ${e.message}`);
  }
}
