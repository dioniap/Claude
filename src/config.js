import "dotenv/config";

function required(name, fallback = undefined) {
  const v = process.env[name] ?? fallback;
  return v;
}

export const config = {
  port: parseInt(process.env.PORT || "3000", 10),

  // ----- Anthropic (cerebro do atendimento) -----
  anthropic: {
    apiKey: required("ANTHROPIC_API_KEY"),
    model: process.env.CLAUDE_MODEL || "claude-opus-4-8",
    effort: process.env.CLAUDE_EFFORT || "medium",
    maxTokens: parseInt(process.env.CLAUDE_MAX_TOKENS || "16000", 10),
  },

  // ----- WhatsApp Cloud API (Meta) - numero oficial +55 86 95428-7581 -----
  whatsapp: {
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || "1198577410012883",
    wabaId: process.env.WHATSAPP_WABA_ID || "",
    accessToken: required("WHATSAPP_ACCESS_TOKEN"),
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN || "simplifica-laudos-verify",
    appSecret: process.env.WHATSAPP_APP_SECRET || "",
    apiVersion: process.env.WHATSAPP_API_VERSION || "v21.0",
    // Template aprovado na Meta usado nos disparos feitos por este sistema
    template: {
      name: process.env.WHATSAPP_TEMPLATE_NAME || "apresentacao_laudos",
      language: process.env.WHATSAPP_TEMPLATE_LANGUAGE || "pt_BR",
      // URL publica da imagem do cabecalho do template (se o template tiver header de imagem)
      headerImageUrl: process.env.WHATSAPP_TEMPLATE_IMAGE_URL || "",
    },
  },

  // ----- Redrive (CRM / disparos em massa) -----
  redrive: {
    baseUrl: process.env.REDRIVE_BASE_URL || "https://api.redrive.com.br",
    token: process.env.REDRIVE_API_TOKEN || "",
    // Bot (numero conectado no Redrive) usado para avisar o Dioni sem depender da janela de 24h da Meta
    botPhone: process.env.REDRIVE_BOT_PHONE || "",
  },

  // ----- Escalonamento para humano -----
  escalation: {
    // WhatsApp do Dioni que recebe os resumos quando a IA nao consegue resolver
    phone: process.env.ESCALATION_PHONE || "5586994110184",
    // "redrive" (recomendado: sem janela de 24h) | "meta" | "both"
    channel: process.env.ESCALATION_CHANNEL || "both",
  },

  // ----- Comportamento do atendimento -----
  behavior: {
    // Agrupa mensagens seguidas do lead por N segundos antes de responder
    debounceSeconds: parseInt(process.env.DEBOUNCE_SECONDS || "8", 10),
    // Quantas mensagens de historico enviar ao Claude
    historyLimit: parseInt(process.env.HISTORY_LIMIT || "40", 10),
    // Ao detectar resposta manual (celular/coexistencia), pausa a IA nessa conversa por N horas
    pauseOnHumanHours: parseInt(process.env.PAUSE_ON_HUMAN_HOURS || "12", 10),
    // Intervalo minimo entre envios de template no disparo (ms)
    dispatchIntervalMs: parseInt(process.env.DISPATCH_INTERVAL_MS || "6000", 10),
  },

  // ----- Admin API -----
  adminToken: process.env.ADMIN_TOKEN || "",

  dbPath: process.env.DB_PATH || "./data/atende-laudos.db",
};

export function assertConfig() {
  const missing = [];
  if (!config.anthropic.apiKey) missing.push("ANTHROPIC_API_KEY");
  if (!config.whatsapp.accessToken) missing.push("WHATSAPP_ACCESS_TOKEN");
  if (missing.length) {
    console.warn(
      `[config] ATENCAO: variaveis ausentes: ${missing.join(", ")}. ` +
        `O servidor sobe, mas as integracoes correspondentes vao falhar. Veja .env.example.`
    );
  }
  if (!config.adminToken) {
    console.warn(
      "[config] ATENCAO: ADMIN_TOKEN nao definido - as rotas /api/* ficam abertas. Defina em producao."
    );
  }
}
