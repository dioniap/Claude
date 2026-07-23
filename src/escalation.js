import { config } from "./config.js";
import { sendText } from "./whatsapp.js";
import { redriveEnabled, sendBotMessage } from "./redrive.js";

const MOTIVO_LABEL = {
  pedido_do_lead: "Lead pediu atendimento humano",
  duvida_nao_coberta: "Dúvida não coberta pela base de conhecimento",
  modelo_de_laudo_autorizado: "Lead autorizou envio do modelo de laudo",
  documentos_completos: "Documentação completa recebida — iniciar análise",
  fechamento: "Lead quer fechar o serviço",
  reclamacao: "Reclamação / situação delicada",
  outro: "Outro",
};

/**
 * Avisa o Dioni no WhatsApp pessoal com o resumo do caso e o contato do lead.
 *
 * Canais (ESCALATION_CHANNEL):
 *  - "redrive": envia pelo bot do Redrive (numero nao-oficial conectado por QR) —
 *    nao depende da janela de 24h da API oficial.
 *  - "meta": envia pelo numero oficial via Cloud API — so chega se o Dioni tiver
 *    conversado com o numero nas ultimas 24h (janela de atendimento).
 *  - "both" (padrao): tenta o Redrive primeiro e usa a Cloud API como fallback.
 */
export async function notifyDioni({ leadPhone, leadName, motivo, resumo }) {
  const texto =
    `🔔 *Atendimento IA — Laudos*\n\n` +
    `*Motivo:* ${MOTIVO_LABEL[motivo] || motivo}\n` +
    `*Lead:* ${leadName || "(sem nome)"}\n` +
    `*WhatsApp:* +${leadPhone}\n` +
    `wa.me/${leadPhone}\n\n` +
    `*Resumo:*\n${resumo}`;

  const channel = config.escalation.channel;
  const to = config.escalation.phone;
  const errors = [];

  if ((channel === "redrive" || channel === "both") && redriveEnabled()) {
    try {
      await sendBotMessage(to, texto.replace(/\*/g, ""));
      return;
    } catch (e) {
      errors.push(`redrive: ${e.message}`);
    }
  }

  if (channel === "meta" || channel === "both") {
    try {
      await sendText(to, texto);
      return;
    } catch (e) {
      errors.push(`meta: ${e.message}`);
    }
  }

  if (errors.length) {
    console.error(`[escalation] falha ao notificar Dioni: ${errors.join(" | ")}`);
  }
}
