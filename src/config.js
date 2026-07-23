import "dotenv/config";

function required(name, fallback = undefined) {
  const v = process.env[name] ?? fallback;
  return v;
}

export const config = {
  port: parseInt(process.env.PORT || "3000", 10),
  // Endereco publico do sistema (painel e webhook da Meta)
  publicUrl: (process.env.PUBLIC_URL || "https://vendalaudos.simplificapn.com").replace(/\/$/, ""),

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
    // Template de utilidade usado para avisar o Dioni fora da janela de 24h
    // (crie um template com 1 variavel no corpo, ex.: "Novo atendimento aguardando: {{1}}")
    escalationTemplate: {
      name: process.env.WHATSAPP_ESCALATION_TEMPLATE_NAME || "",
      language: process.env.WHATSAPP_ESCALATION_TEMPLATE_LANGUAGE || "pt_BR",
    },
  },

  // ----- Redrive (CRM / leads) -----
  redrive: {
    baseUrl: process.env.REDRIVE_BASE_URL || "https://api.redrive.com.br",
    token: process.env.REDRIVE_API_TOKEN || "",
  },

  // ----- Escalonamento para humano (sempre pela API oficial da Meta) -----
  escalation: {
    // WhatsApp do Dioni que recebe os resumos quando a IA nao consegue resolver
    phone: process.env.ESCALATION_PHONE || "5586994110184",
  },

  // ----- E-mail (Hostinger) - usado no "esqueci minha senha" do painel -----
  smtp: {
    host: process.env.SMTP_HOST || "smtp.hostinger.com",
    port: parseInt(process.env.SMTP_PORT || "465", 10),
    secure: (process.env.SMTP_SECURE || "true") === "true",
    user: process.env.SMTP_USER || "",
    pass: process.env.SMTP_PASS || "",
    from: process.env.MAIL_FROM || process.env.SMTP_USER || "",
  },

  // ----- G-Click (solicitacoes do setor de laudos periciais) -----
  // Copie os valores do sistema omnichannel (onde a integracao ja funciona).
  gclick: {
    baseUrl: process.env.GCLICK_BASE_URL || "https://api.gclick.com.br",
    authUrl: process.env.GCLICK_AUTH_URL || "",
    clientId: process.env.GCLICK_CLIENT_ID || "",
    clientSecret: process.env.GCLICK_CLIENT_SECRET || "",
    user: process.env.GCLICK_USER || "",
    pass: process.env.GCLICK_PASS || "",
    empId: process.env.GCLICK_EMP_ID || "2093",
    // Ajuste os caminhos se o omnichannel usar rotas diferentes
    solicitacoesPath: process.env.GCLICK_SOLICITACOES_PATH || "/solicitacoes",
  },

  // ----- Comportamento do atendimento -----
  behavior: {
    // Agrupa mensagens seguidas do lead por N segundos antes de responder
    debounceSeconds: parseInt(process.env.DEBOUNCE_SECONDS || "8", 10),
    // Quantas mensagens de historico enviar ao Claude
    historyLimit: parseInt(process.env.HISTORY_LIMIT || "40", 10),
    // Ao detectar resposta manual (celular/coexistencia), pausa a IA nessa conversa por N horas
    // (no painel e possivel devolver o atendimento para a IA a qualquer momento)
    pauseOnHumanHours: parseInt(process.env.PAUSE_ON_HUMAN_HOURS || "12", 10),
    // Intervalo minimo entre envios de template no disparo (ms)
    dispatchIntervalMs: parseInt(process.env.DISPATCH_INTERVAL_MS || "6000", 10),
  },

  // ----- Admin API (integracoes/scripts; o painel usa login por usuario) -----
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
  if (!config.smtp.user || !config.smtp.pass) {
    console.warn(
      "[config] ATENCAO: SMTP nao configurado - o 'esqueci minha senha' do painel nao vai enviar e-mail."
    );
  }
}
