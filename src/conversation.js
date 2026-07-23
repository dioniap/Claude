import { config } from "./config.js";
import {
  getHistory,
  getLead,
  isConversationPaused,
  messageAlreadyProcessed,
  saveMessage,
  setConversationStatus,
  updateLeadStatus,
  upsertLead,
} from "./db.js";
import { generateReply } from "./claude.js";
import { downloadMedia, markAsRead, sendText } from "./whatsapp.js";

// Buffer por lead: agrupa mensagens seguidas antes de chamar a IA
// phone -> { timer, parts: [{text, mediaBlock, label}] }
const buffers = new Map();

const CLAUDE_MEDIA_TYPES = {
  image: ["image/jpeg", "image/png", "image/gif", "image/webp"],
  document: ["application/pdf"],
};

function mediaBlockFor(mimeType, buffer) {
  if (CLAUDE_MEDIA_TYPES.image.includes(mimeType)) {
    return {
      type: "image",
      source: { type: "base64", media_type: mimeType, data: buffer.toString("base64") },
    };
  }
  if (CLAUDE_MEDIA_TYPES.document.includes(mimeType)) {
    return {
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: buffer.toString("base64") },
    };
  }
  return null;
}

/**
 * Extrai o conteudo util de uma mensagem do webhook da Meta.
 * Retorna { text, mediaBlock, label, mediaType } ou null se nao suportado.
 */
async function extractIncoming(message) {
  const type = message.type;

  if (type === "text") {
    return { text: message.text?.body || "", label: message.text?.body || "", mediaType: null };
  }
  if (type === "button") {
    const t = message.button?.text || message.button?.payload || "";
    return { text: t, label: `[botão] ${t}`, mediaType: null };
  }
  if (type === "interactive") {
    const t =
      message.interactive?.button_reply?.title ||
      message.interactive?.list_reply?.title ||
      "";
    return { text: t, label: `[botão] ${t}`, mediaType: null };
  }
  if (type === "image" || type === "document") {
    const media = type === "image" ? message.image : message.document;
    const filename = media?.filename || (type === "image" ? "imagem" : "documento");
    const caption = media?.caption || "";
    try {
      const { buffer, mimeType, sizeBytes } = await downloadMedia(media.id);
      if (sizeBytes && sizeBytes > 25 * 1024 * 1024) {
        return {
          text: `[O lead enviou um arquivo "${filename}" grande demais para análise automática. Peça para enviar em partes ou por e-mail.]`,
          label: `[arquivo grande] ${filename}`,
          mediaType: type,
        };
      }
      const block = mediaBlockFor(mimeType, buffer);
      if (block) {
        return {
          text: caption,
          mediaBlock: block,
          blockNote: `[O lead enviou o arquivo "${filename}" (${mimeType})${caption ? ` com a legenda: "${caption}"` : ""}. Analise o conteúdo para a triagem.]`,
          label: `[${type === "image" ? "imagem" : "documento"}] ${filename}${caption ? ` — ${caption}` : ""}`,
          mediaType: type,
        };
      }
      return {
        text: `[O lead enviou o arquivo "${filename}" no formato ${mimeType}, que não é suportado para análise automática. Oriente a enviar em PDF ou foto legível.]`,
        label: `[arquivo não suportado] ${filename}`,
        mediaType: type,
      };
    } catch (e) {
      console.error(`[conversation] falha ao baixar midia:`, e.message);
      return {
        text: `[O lead enviou um arquivo "${filename}", mas houve falha ao baixá-lo. Peça para reenviar.]`,
        label: `[falha no download] ${filename}`,
        mediaType: type,
      };
    }
  }
  if (type === "audio" || type === "video") {
    return {
      text: `[O lead enviou um ${type === "audio" ? "áudio" : "vídeo"}, que você não consegue ouvir/assistir. Peça com educação para resumir por texto, ou escale se ele insistir.]`,
      label: `[${type}]`,
      mediaType: type,
    };
  }
  return null;
}

/**
 * Processa uma mensagem recebida do lead (chamado pelo webhook).
 */
export async function handleIncomingMessage(message, contact) {
  const phone = message.from;
  const waMessageId = message.id;
  if (messageAlreadyProcessed(waMessageId)) return; // reentrega da Meta

  const profileName = contact?.profile?.name;
  upsertLead({ phone, name: profileName, source: "inbound" });

  const incoming = await extractIncoming(message);
  if (!incoming) return;

  saveMessage({
    phone,
    waMessageId,
    role: "user",
    content: incoming.label,
    mediaType: incoming.mediaType,
  });
  markAsRead(waMessageId);

  const lead = getLead(phone);
  if (lead && (lead.status === "novo" || lead.status === "contatado")) {
    updateLeadStatus(phone, "conversando");
  }

  if (isConversationPaused(phone)) {
    console.log(`[conversation] ${phone} pausada/escalada — IA não responde.`);
    return;
  }

  // Debounce: agrupa mensagens seguidas antes de responder
  let buf = buffers.get(phone);
  if (!buf) {
    buf = { parts: [], timer: null };
    buffers.set(phone, buf);
  }
  buf.parts.push(incoming);
  if (buf.timer) clearTimeout(buf.timer);
  buf.timer = setTimeout(() => {
    buffers.delete(phone);
    respond(phone, buf.parts).catch((e) =>
      console.error(`[conversation] erro ao responder ${phone}:`, e)
    );
  }, config.behavior.debounceSeconds * 1000);
}

async function respond(phone, parts) {
  if (isConversationPaused(phone)) return;

  const lead = getLead(phone);
  // O historico ja contem as mensagens deste lote (salvas no webhook); remove-as
  // do historico para nao duplicar com o conteudo atual.
  const fullHistory = getHistory(phone, config.behavior.historyLimit + parts.length);
  const history = fullHistory.slice(0, Math.max(0, fullHistory.length - parts.length));

  const currentContent = [];
  for (const p of parts) {
    if (p.mediaBlock) {
      if (p.blockNote) currentContent.push({ type: "text", text: p.blockNote });
      currentContent.push(p.mediaBlock);
      if (p.text) currentContent.push({ type: "text", text: p.text });
    } else if (p.text) {
      currentContent.push({ type: "text", text: p.text });
    }
  }
  if (!currentContent.length) return;

  const reply = await generateReply({
    phone,
    leadName: lead?.name,
    history,
    currentContent,
  });

  if (!reply) return;
  // Se a IA se pausou via ferramenta durante o processamento (escalada com pausar_ia),
  // ainda enviamos esta ultima resposta (ex.: "o Dioni vai te chamar"), que faz parte do fluxo.

  await sendWhatsAppReply(phone, reply);
  saveMessage({ phone, role: "assistant", content: reply });
}

async function sendWhatsAppReply(phone, text) {
  // Limite de 4096 chars por mensagem na Cloud API
  const chunks = [];
  let remaining = text;
  while (remaining.length > 4000) {
    let cut = remaining.lastIndexOf("\n", 4000);
    if (cut < 1000) cut = 4000;
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).trimStart();
  }
  if (remaining) chunks.push(remaining);
  for (const chunk of chunks) {
    await sendText(phone, chunk);
  }
}

/**
 * Detecta resposta manual enviada pelo celular (coexistencia WhatsApp Business app
 * + Cloud API). Quando o Dioni responde manualmente um lead, a IA pausa naquela
 * conversa por PAUSE_ON_HUMAN_HOURS horas para nao atropelar o atendimento humano.
 */
export function handleHumanEcho(echoMessage) {
  const phone = echoMessage?.to;
  if (!phone) return;
  const hours = config.behavior.pauseOnHumanHours;
  if (!hours) return;
  const until = new Date(Date.now() + hours * 3600 * 1000)
    .toISOString()
    .replace("T", " ")
    .slice(0, 19);
  setConversationStatus(phone, "pausada", until);
  const body = echoMessage?.text?.body;
  if (body) {
    saveMessage({ phone, role: "assistant", content: `[resposta manual do Dioni] ${body}` });
  }
  console.log(`[conversation] resposta manual detectada para ${phone}; IA pausada até ${until}`);
}
