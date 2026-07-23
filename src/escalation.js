import { config } from "./config.js";
import { sendText, sendEscalationTemplate } from "./whatsapp.js";

const MOTIVO_LABEL = {
  pedido_do_lead: "Lead pediu atendimento humano",
  duvida_nao_coberta: "Dúvida não coberta pela base de conhecimento",
  modelo_de_laudo_autorizado: "Lead autorizou envio do modelo de laudo",
  documentos_completos: "Documentação completa recebida — iniciar análise",
  fechamento: "Lead quer fechar o serviço",
  reclamacao: "Reclamação / situação delicada",
  outro: "Outro",
};

/** Parametros de template da Meta nao aceitam quebras de linha/tabs. */
function templateParamSafe(text, max = 700) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/**
 * Avisa o Dioni no WhatsApp com o resumo do caso e o contato do lead —
 * SEMPRE pela API oficial da Meta:
 *
 * 1. Tenta mensagem de texto livre (funciona se o Dioni interagiu com o
 *    numero nas ultimas 24h — janela de atendimento).
 * 2. Fora da janela, envia o TEMPLATE de escalonamento aprovado
 *    (WHATSAPP_ESCALATION_TEMPLATE_NAME) com o resumo na variavel do corpo.
 */
export async function notifyDioni({ leadPhone, leadName, motivo, resumo }) {
  const texto =
    `🔔 *Atendimento IA — Laudos*\n\n` +
    `*Motivo:* ${MOTIVO_LABEL[motivo] || motivo}\n` +
    `*Lead:* ${leadName || "(sem nome)"}\n` +
    `*WhatsApp:* +${leadPhone}\n` +
    `wa.me/${leadPhone}\n\n` +
    `*Resumo:*\n${resumo}`;

  const to = config.escalation.phone;

  try {
    await sendText(to, texto);
    return;
  } catch (e) {
    console.warn(
      `[escalation] texto livre falhou (provavel janela de 24h fechada): ${e.message}`
    );
  }

  if (!config.whatsapp.escalationTemplate.name) {
    console.error(
      "[escalation] WHATSAPP_ESCALATION_TEMPLATE_NAME nao configurado - aviso NAO entregue. " +
        "Crie um template de utilidade com 1 variavel e configure no .env."
    );
    return;
  }

  const paramText = templateParamSafe(
    `${MOTIVO_LABEL[motivo] || motivo} — Lead: ${leadName || "sem nome"} (+${leadPhone}). ${resumo}`
  );
  try {
    await sendEscalationTemplate(to, paramText);
  } catch (e) {
    console.error(`[escalation] template de escalonamento falhou: ${e.message}`);
  }
}
