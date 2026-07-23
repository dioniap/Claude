import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { updateLeadStatus, setConversationStatus } from "./db.js";
import { notifyDioni } from "./escalation.js";
import { safeLogToRedrive } from "./redrive.js";

const here = path.dirname(fileURLToPath(import.meta.url));
// "missing-key" evita crash na subida quando a chave ainda nao foi configurada;
// as chamadas falham com erro claro de autenticacao ate o .env ser preenchido.
const client = new Anthropic({ apiKey: config.anthropic.apiKey || "missing-key" });

const knowledgeBase = fs.readFileSync(
  path.join(here, "..", "knowledge", "base.md"),
  "utf-8"
);

const SYSTEM_PROMPT = `Você é o assistente comercial da Simplifica Contabilidade, atendendo pelo WhatsApp em nome do perito contábil Dioni Alves Pereira (CRC MA012728/O-3). Você conversa com ADVOGADOS(AS) que receberam nossa mensagem de apresentação sobre laudos e cálculos periciais contábeis, ou que entraram em contato por conta própria.

SEU OBJETIVO: conduzir a conversa até fechar o serviço de laudo pericial — apresentar os serviços, tirar dúvidas, receber e triar documentos, informar valores e prazos, e combinar o fechamento. Quando não conseguir resolver, escalar para o Dioni com a ferramenta disponível.

COMO SE COMUNICAR NO WHATSAPP:
- Trate o lead por "Dr." ou "Dra." + nome quando souber o nome; senão "Doutor(a)".
- Mensagens curtas, cordiais e diretas — é WhatsApp, não e-mail. Evite parágrafos longos e listas enormes; no máximo alguns itens quando necessário.
- Português brasileiro natural e profissional. Emojis com muita moderação (no máximo um, quando couber).
- Nunca invente informação: valores, prazos, e-mails e condições vêm EXCLUSIVAMENTE da base de conhecimento abaixo. Se a informação não estiver lá (ou estiver marcada como [PREENCHER]), diga que vai confirmar com o perito e use a ferramenta de escalonamento.
- Não dê parecer jurídico nem prometa resultado de processo. Você vende o serviço pericial.
- Faça uma pergunta por vez. Conduza para o próximo passo concreto (ex.: "me envia o contrato em PDF aqui mesmo que eu já faço a triagem").

TRIAGEM DE DOCUMENTOS RECEBIDOS:
- Quando o lead enviar imagem ou PDF, analise: é o documento certo para o tipo de caso? Está legível/completo? Falta alguma página ou documento complementar?
- Responda dizendo o que foi recebido, se serve, e o que ainda falta (consulte a lista de documentos necessários na base de conhecimento).
- Recebendo o conjunto completo, confirme e informe o prazo da análise de viabilidade gratuita; em seguida use a ferramenta de escalonamento com motivo "documentos_completos" para o perito iniciar a análise.

QUANDO ESCALAR PARA O DIONI (ferramenta escalar_para_humano):
- Lead pediu para falar com humano/perito.
- Pergunta técnica ou comercial que a base de conhecimento não cobre (valor não listado, condição especial, caso fora do escopo).
- Lead autorizou o envio do modelo de laudo ("pode enviar").
- Documentação completa recebida (motivo "documentos_completos").
- Lead demonstrou intenção clara de fechar (motivo "fechamento").
- Reclamação, irritação ou situação delicada.
Após escalar, avise o lead com naturalidade que o perito Dioni vai assumir/retornar em breve — sem dizer que você é um robô limitado.

REGISTRO DO FUNIL (ferramenta atualizar_status_lead): mantenha o status do lead atualizado conforme a conversa evolui (conversando, interessado, negociando, fechado, perdido).

===== BASE DE CONHECIMENTO =====
${knowledgeBase}
===== FIM DA BASE DE CONHECIMENTO =====`;

const TOOLS = [
  {
    name: "escalar_para_humano",
    description:
      "Envia um resumo do caso para o WhatsApp do Dioni (perito responsável) para que um humano assuma a conversa. Use quando não conseguir resolver, quando o lead pedir contato humano, quando autorizar o envio do modelo de laudo, quando a documentação estiver completa ou quando o lead quiser fechar.",
    input_schema: {
      type: "object",
      properties: {
        motivo: {
          type: "string",
          enum: [
            "pedido_do_lead",
            "duvida_nao_coberta",
            "modelo_de_laudo_autorizado",
            "documentos_completos",
            "fechamento",
            "reclamacao",
            "outro",
          ],
          description: "Categoria do escalonamento",
        },
        resumo: {
          type: "string",
          description:
            "Resumo objetivo do caso para o Dioni: quem é o lead, o que quer, em que pé está a conversa e o que precisa ser feito",
        },
        pausar_ia: {
          type: "boolean",
          description:
            "true para a IA parar de responder este lead até o Dioni assumir (use em fechamento, reclamação e pedido de humano); false para a IA continuar atendendo em paralelo",
        },
      },
      required: ["motivo", "resumo", "pausar_ia"],
    },
  },
  {
    name: "atualizar_status_lead",
    description:
      "Atualiza o status do lead no funil de vendas (registrado no banco local e, quando disponível, como follow-up no CRM do Redrive).",
    input_schema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: [
            "conversando",
            "interessado",
            "negociando",
            "fechado",
            "perdido",
          ],
        },
        observacao: {
          type: "string",
          description: "Nota curta sobre o motivo da mudança de status",
        },
      },
      required: ["status"],
    },
  },
];

async function runTool(name, input, ctx) {
  if (name === "escalar_para_humano") {
    const { motivo, resumo, pausar_ia } = input;
    await notifyDioni({
      leadPhone: ctx.phone,
      leadName: ctx.leadName,
      motivo,
      resumo,
    });
    updateLeadStatus(ctx.phone, "escalado", `[${motivo}] ${resumo}`);
    if (pausar_ia) {
      setConversationStatus(ctx.phone, "escalada");
    }
    safeLogToRedrive(ctx.phone, `IA escalou (${motivo}): ${resumo}`, {
      tag: "escalado-ia",
    });
    return `Escalonamento enviado ao Dioni (motivo: ${motivo}). ${
      pausar_ia
        ? "A IA foi pausada para este lead; informe ao lead que o Dioni vai assumir."
        : "A IA segue atendendo em paralelo."
    }`;
  }
  if (name === "atualizar_status_lead") {
    const { status, observacao } = input;
    updateLeadStatus(ctx.phone, status, observacao);
    safeLogToRedrive(
      ctx.phone,
      `Status IA: ${status}${observacao ? ` — ${observacao}` : ""}`
    );
    return `Status do lead atualizado para "${status}".`;
  }
  return `Ferramenta desconhecida: ${name}`;
}

/**
 * Gera a resposta da IA para uma conversa.
 * @param {object} params
 * @param {string} params.phone - telefone do lead
 * @param {string} [params.leadName]
 * @param {Array<{role:string, content:string}>} params.history - historico salvo (texto)
 * @param {Array} params.currentContent - blocos de conteudo da mensagem atual
 *   (texto e/ou blocos image/document da midia recebida agora)
 * @returns {Promise<string|null>} texto da resposta (null se nao houver o que responder)
 */
export async function generateReply({ phone, leadName, history, currentContent }) {
  const messages = [];
  for (const m of history) {
    if (!m.content || !String(m.content).trim()) continue;
    messages.push({ role: m.role, content: m.content });
  }
  // A primeira mensagem da conversa precisa ser do usuario
  while (messages.length && messages[0].role !== "user") messages.shift();
  messages.push({ role: "user", content: currentContent });

  const ctx = { phone, leadName };
  let response;

  // Loop agentico manual: executa ferramentas ate o Claude concluir a resposta.
  for (let iteration = 0; iteration < 6; iteration++) {
    response = await client.messages.create({
      model: config.anthropic.model,
      max_tokens: config.anthropic.maxTokens,
      thinking: { type: "adaptive" },
      output_config: { effort: config.anthropic.effort },
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      tools: TOOLS,
      messages,
    });

    if (response.stop_reason !== "tool_use") break;

    messages.push({ role: "assistant", content: response.content });
    const toolResults = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;
      let result;
      try {
        result = await runTool(block.name, block.input, ctx);
      } catch (e) {
        console.error(`[claude] ferramenta ${block.name} falhou:`, e);
        result = `Erro ao executar: ${e.message}`;
      }
      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: result,
      });
    }
    messages.push({ role: "user", content: toolResults });
  }

  if (response?.stop_reason === "refusal") {
    console.warn(`[claude] refusal para ${phone}`);
    return null;
  }

  const text = (response?.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  return text || null;
}
