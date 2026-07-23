import { config } from "./config.js";

const GRAPH = "https://graph.facebook.com";

function apiUrl(pathSegment) {
  return `${GRAPH}/${config.whatsapp.apiVersion}/${pathSegment}`;
}

async function graphRequest(pathSegment, { method = "GET", body } = {}) {
  const res = await fetch(apiUrl(pathSegment), {
    method,
    headers: {
      Authorization: `Bearer ${config.whatsapp.accessToken}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json?.error?.message || `HTTP ${res.status}`;
    const err = new Error(`WhatsApp API: ${msg}`);
    err.details = json?.error;
    err.status = res.status;
    throw err;
  }
  return json;
}

/** Normaliza numeros BR para o formato aceito pela Cloud API (ex.: 5586994110184). */
export function normalizePhone(raw) {
  let digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("0")) digits = digits.replace(/^0+/, "");
  // sem DDI -> assume Brasil
  if (digits.length === 10 || digits.length === 11) digits = "55" + digits;
  return digits;
}

export async function sendText(to, text) {
  return graphRequest(`${config.whatsapp.phoneNumberId}/messages`, {
    method: "POST",
    body: {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { preview_url: false, body: text },
    },
  });
}

/**
 * Envia o template aprovado de apresentacao (disparo).
 * Assume 1 variavel no corpo ({{1}} ou {{nome}}) e, se configurado, header de imagem.
 */
export async function sendTemplate(to, { name: leadName } = {}) {
  const t = config.whatsapp.template;
  const components = [];
  if (t.headerImageUrl) {
    components.push({
      type: "header",
      parameters: [{ type: "image", image: { link: t.headerImageUrl } }],
    });
  }
  components.push({
    type: "body",
    parameters: [{ type: "text", text: leadName || "Doutor(a)" }],
  });
  return graphRequest(`${config.whatsapp.phoneNumberId}/messages`, {
    method: "POST",
    body: {
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: t.name,
        language: { code: t.language },
        components,
      },
    },
  });
}

export async function markAsRead(messageId) {
  try {
    await graphRequest(`${config.whatsapp.phoneNumberId}/messages`, {
      method: "POST",
      body: { messaging_product: "whatsapp", status: "read", message_id: messageId },
    });
  } catch {
    // nao critico
  }
}

/**
 * Baixa uma midia recebida (imagem/documento) e devolve { buffer, mimeType }.
 * Fluxo Meta: GET /{media-id} -> url temporaria -> GET url com o mesmo token.
 */
export async function downloadMedia(mediaId) {
  const meta = await graphRequest(mediaId);
  const res = await fetch(meta.url, {
    headers: { Authorization: `Bearer ${config.whatsapp.accessToken}` },
  });
  if (!res.ok) throw new Error(`Falha ao baixar midia (${res.status})`);
  const buffer = Buffer.from(await res.arrayBuffer());
  return { buffer, mimeType: meta.mime_type, sizeBytes: meta.file_size };
}
