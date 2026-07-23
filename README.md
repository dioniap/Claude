# atende-laudos — Atendente IA no WhatsApp para venda de Laudos Periciais

Sistema de atendimento inteligente para o número **+55 86 95428-7581** (ID `1198577410012883`) da Simplifica Contabilidade. O Redrive continua fazendo os disparos em massa do template aprovado; **quando o lead advogado responde, este sistema assume a conversa** com a API da Anthropic (Claude) como cérebro, conduz a negociação até o fechamento do laudo pericial e escala para o Dioni (+55 86 99411-0184) quando necessário.

## O que o sistema faz

| Função | Como |
|---|---|
| Conversa com o lead | Claude (`claude-opus-4-8`) com base de conhecimento em `knowledge/base.md` (serviços, prazos, valores, descontos, e-mail/WhatsApp para documentos) |
| Triagem de documentos | Recebe **PDF e imagens** pelo WhatsApp e o Claude analisa: documento certo? legível? falta algo? |
| Escala para humano | Quando não resolve, envia resumo do caso + contato do lead para o WhatsApp do Dioni (via bot do Redrive, sem janela de 24h; fallback pela Cloud API) |
| Disparos próprios | Envia o template aprovado da Meta para listas: **Redrive (API)**, **Excel** ou **inclusão manual** |
| Coexistência | Se o Dioni responder um lead manualmente pelo celular, a IA **pausa naquela conversa** por 12h (configurável) |
| CRM | Status do lead no funil (SQLite local) + follow-up automático no CRM do Redrive |

## Arquitetura

```
Lead responde no WhatsApp (+55 86 95428-7581)
        │
        ▼
Meta Cloud API ── webhook ──► este servidor (Express)
        │                        │
        │                        ├── SQLite (leads, conversas, mensagens, disparos)
        │                        ├── Claude API (resposta + ferramentas)
        │                        │      ├── escalar_para_humano ──► WhatsApp do Dioni
        │                        │      └── atualizar_status_lead ──► funil + Redrive followup
        │                        └── Redrive API (leads, followup, bot p/ avisos)
        ▼
Resposta enviada ao lead pelo mesmo número oficial
```

## Instalação

```bash
npm install
cp .env.example .env   # preencha as variáveis (veja abaixo)
# edite knowledge/base.md (valores, prazos, e-mail p/ documentos)
npm start
```

O servidor precisa ficar acessível na internet por **HTTPS** para receber o webhook da Meta (use um VPS com domínio + reverse proxy, Railway, Render, ou `cloudflared`/`ngrok` para testes).

---

## 🔑 Credenciais da Meta — onde pegar cada dado

O número já usa a API oficial via Redrive. Para ESTE sistema também se conectar ao mesmo número, você precisa de acesso ao **Gerenciador de Negócios da Meta** onde a conta WhatsApp Business (WABA) desse número está registrada.

### Passo 1 — Confirmar onde está a WABA
1. Acesse [business.facebook.com](https://business.facebook.com) → **Configurações do negócio** → **Contas** → **Contas do WhatsApp Business**.
2. Se a WABA do +55 86 95428-7581 aparecer aí, ótimo — siga adiante. Se **não** aparecer, o Redrive criou a WABA como provedor (BSP); nesse caso peça ao suporte do Redrive para **compartilhar a WABA com o seu Business Manager** ou confirmar em qual portfólio ela está. Sem acesso à WABA não há como conectar um segundo sistema.

### Passo 2 — Criar seu app na Meta
1. Acesse [developers.facebook.com](https://developers.facebook.com) → **Meus apps** → **Criar app** → tipo **Empresa/Business**.
2. Dentro do app, adicione o produto **WhatsApp** e vincule a WABA do número.

### Passo 3 — Coletar os valores do `.env`

| Variável | Onde pegar |
|---|---|
| `WHATSAPP_PHONE_NUMBER_ID` | Já sabemos: **1198577410012883** (painel WhatsApp → Configuração da API) |
| `WHATSAPP_WABA_ID` | Mesmo painel, campo "ID da conta do WhatsApp Business" |
| `WHATSAPP_ACCESS_TOKEN` | **Token permanente**: Configurações do negócio → **Usuários → Usuários do sistema** → criar usuário do sistema (admin) → **Adicionar ativos** (o app e a WABA) → **Gerar token** com as permissões `whatsapp_business_messaging` e `whatsapp_business_management`. *(O token do painel do app expira em 24h — use só para teste.)* |
| `WHATSAPP_APP_SECRET` | App → **Configurações do app → Básico** → "Chave secreta do app" |
| `WHATSAPP_VERIFY_TOKEN` | Você inventa (qualquer string) — o mesmo valor vai no painel do webhook |

### Passo 4 — Configurar o webhook
1. App → **WhatsApp → Configuração** → seção **Webhook** → **Editar**:
   - **URL de callback:** `https://SEU-DOMINIO/webhook`
   - **Token de verificação:** o valor de `WHATSAPP_VERIFY_TOKEN`
2. Em **Campos do webhook**, assine **`messages`** (e, se disponível, **`smb_message_echoes`** — usado para detectar quando você responde manualmente pelo celular e pausar a IA).

> **Importante:** o webhook é configurado **por app**, não por número. O app do Redrive continua recebendo os eventos dele; o seu app recebe os seus. Os dois convivem no mesmo número sem conflito — o mesmo vale para o envio de mensagens.

### Outras credenciais

| Variável | Onde pegar |
|---|---|
| `ANTHROPIC_API_KEY` | [platform.claude.com](https://platform.claude.com) → API Keys |
| `REDRIVE_API_TOKEN` | Painel do Redrive (token JWT da Customer API — o que você já possui) |

---

## Uso da API administrativa

Todas as rotas exigem `Authorization: Bearer <ADMIN_TOKEN>` (se configurado).

```bash
# saúde do sistema
curl -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3000/api/health

# incluir leads manualmente (e já enfileirar o disparo do template)
curl -X POST http://localhost:3000/api/leads \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"dispatch": true, "campaign": "abril", "contacts": [{"phone": "5586999990000", "name": "Maria Silva"}]}'

# importar planilha Excel (colunas: telefone/nome/email) e enfileirar disparo
curl -X POST "http://localhost:3000/api/leads/excel?dispatch=1&campaign=abril" \
  -H "Authorization: Bearer $ADMIN_TOKEN" -F "file=@leads.xlsx"

# puxar leads do CRM do Redrive e enfileirar disparo
curl -X POST http://localhost:3000/api/leads/redrive \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"campaign": "redrive-abril", "params": {"createdAtStart": "2026-07-01", "createdAtEnd": "2026-07-23"}}'

# iniciar / parar / acompanhar o disparo
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3000/api/dispatch/start
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3000/api/dispatch/stop
curl -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3000/api/dispatch/stats

# conversas
curl -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3000/api/conversations
curl -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3000/api/conversations/5586999990000/messages
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3000/api/conversations/5586999990000/pause
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3000/api/conversations/5586999990000/resume
```

## Fluxo de atendimento

1. Redrive (ou este sistema) dispara o template aprovado.
2. O lead responde → webhook entrega a mensagem → a IA aguarda ~8s (agrupa mensagens seguidas) e responde.
3. Documentos PDF/imagem são baixados e analisados pelo Claude na triagem.
4. A IA atualiza o funil (`conversando → interessado → negociando → fechado/perdido`) e registra follow-up no Redrive.
5. Quando não resolve — ou quando o lead autoriza o modelo de laudo, envia a documentação completa ou quer fechar — a IA **escala para o Dioni** com resumo + contato e (quando apropriado) pausa o próprio atendimento.
6. Se o Dioni responder pelo celular, a IA detecta (echo de coexistência) e pausa naquela conversa.

## Observações importantes

- **Janela de 24h da Meta:** o número oficial só envia mensagem livre para quem interagiu nas últimas 24h. Fora da janela, apenas template aprovado. Por isso o aviso ao Dioni sai preferencialmente pelo bot do Redrive.
- **`knowledge/base.md`** é a fonte única de verdade da IA: valores, prazos, e-mail para documentos, descontos. Campos `[PREENCHER]` fazem a IA escalar em vez de inventar.
- **Ritmo de disparo:** padrão de ~10 templates/min (`DISPATCH_INTERVAL_MS`) para preservar a qualidade do número na Meta. Aumente com cautela.
- O banco local fica em `./data/atende-laudos.db` (SQLite) — faça backup.
