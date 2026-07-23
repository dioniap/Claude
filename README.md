# atende-laudos — Atendente IA + Painel de Atendimento (WhatsApp / Laudos Periciais)

Sistema de atendimento inteligente para o número **+55 86 95428-7581** (ID `1198577410012883`) da Simplifica Contabilidade. O Redrive continua fazendo os disparos em massa do template aprovado; **quando o lead advogado responde, este sistema assume a conversa** com a API da Anthropic (Claude) como cérebro, conduz a negociação até o fechamento do laudo pericial e escala para o Dioni (+55 86 99411-0184) quando necessário — **sempre pela API oficial da Meta** (texto dentro da janela de 24h; template de utilidade fora dela).

Inclui o **Painel de Atendimento** web com login por e-mail, onde Dioni e Amanda acompanham as conversas, assumem atendimentos, devolvem para a IA, conversam entre si (chat interno) e consultam as solicitações de laudos periciais no **G-Click**.

## O que o sistema faz

| Função | Como |
|---|---|
| Conversa com o lead | Claude (`claude-opus-4-8`) com base de conhecimento em `knowledge/base.md` (serviços, prazos, valores, descontos, e-mail/WhatsApp para documentos) |
| Triagem de documentos | Recebe **PDF e imagens** pelo WhatsApp e o Claude analisa: documento certo? legível? falta algo? |
| Escala para humano | Envia resumo do caso + contato do lead para o WhatsApp do Dioni pela **API oficial**: texto livre dentro da janela de 24h; fora dela, template de utilidade (`WHATSAPP_ESCALATION_TEMPLATE_NAME`) |
| Painel de atendimento | Login por e-mail (Dioni e Amanda), conversas com filtros (com a IA / com cada usuário / todas), assumir atendimento, **devolver para a IA**, responder o lead pelo painel |
| Chat interno | Conversa entre os usuários do painel, com contador de não lidas |
| G-Click | Consulta das solicitações do setor de laudos periciais: filtros por cliente, descrição, prazos de início/meta/vencimento e download dos documentos das tarefas |
| Disparos próprios | Envia o template aprovado da Meta para listas: **Redrive (API)**, **Excel** ou **inclusão manual** |
| Coexistência | Se alguém responder um lead manualmente pelo celular, a IA **pausa naquela conversa** (12h por padrão) — no painel dá para devolver para a IA a qualquer momento |
| CRM | Status do lead no funil (SQLite local) + follow-up automático no CRM do Redrive |

## Painel de Atendimento

- **URL:** `https://SEU-DOMINIO/` (o próprio servidor serve o painel)
- **Usuários iniciais:** Dioni (`dioni630@gmail.com`) e Amanda (`amanda.morais81@gmail.com`), senha inicial `12345678` — **troquem no primeiro acesso**.
- **Esqueci minha senha:** o sistema envia uma **senha provisória** pelo e-mail da Hostinger (`SMTP_*` no `.env`) e obriga a troca no próximo acesso.
- **Conversas:** filtros *Todas / Com a IA / Comigo / Com <usuário>*. Ao **assumir**, a IA para de responder aquele lead e você fala com ele direto do painel; **Devolver para IA** reativa o atendimento automático (inclusive quando a conversa pausou por resposta manual no celular).
- **Chat interno:** menu próprio para troca de mensagens entre os usuários do painel.
- **G-Click:** aba de solicitações com filtros e documentos. Requer as credenciais `GCLICK_*` no `.env` (copie do sistema omnichannel, onde a integração já funciona; se lá os endpoints forem outros, ajuste `GCLICK_BASE_URL`/`GCLICK_AUTH_URL`/`GCLICK_SOLICITACOES_PATH`).

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
| `WHATSAPP_ESCALATION_TEMPLATE_NAME` | Crie na Meta (WhatsApp → Templates) um template de **utilidade** com 1 variável no corpo, ex.: `Novo atendimento aguardando no painel: {{1}}` — usado para te avisar fora da janela de 24h |

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
| `REDRIVE_API_TOKEN` | Painel do Redrive (token JWT da Customer API) |
| `SMTP_PASS` | Senha do e-mail `contato@simplificapn.com` na Hostinger (painel Hostinger → E-mails) |
| `GCLICK_*` | Copie do `.env`/configuração do sistema omnichannel da Simplifica |

---

## APIs

### Painel (`/auth/*` e `/panel/*` — login por usuário)

| Rota | Função |
|---|---|
| `POST /auth/login` `{email, senha}` | Login (retorna token de sessão) |
| `POST /auth/forgot` `{email}` | Envia senha provisória por e-mail |
| `POST /auth/change-password` | Troca de senha (obrigatória após senha provisória) |
| `GET /panel/conversations?filter=ia\|user:<id>\|all` | Conversas com filtros |
| `GET /panel/conversations/:phone/messages` | Histórico da conversa |
| `POST /panel/conversations/:phone/assume` | Assumir atendimento (IA para) |
| `POST /panel/conversations/:phone/return-to-ia` | Devolver atendimento para a IA |
| `POST /panel/conversations/:phone/send` `{text}` | Responder o lead pelo painel |
| `GET/POST /panel/internal/:userId/messages` | Chat interno |
| `GET /panel/gclick/solicitacoes?...` | Solicitações do G-Click com filtros |
| `GET /panel/gclick/solicitacoes/:id/documentos` | Documentos da solicitação |

### Integrações/scripts (`/api/*` — login do painel OU `ADMIN_TOKEN`)

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
```

## Fluxo de atendimento

1. Redrive (ou este sistema) dispara o template aprovado.
2. O lead responde → webhook entrega a mensagem → a IA aguarda ~8s (agrupa mensagens seguidas) e responde.
3. Documentos PDF/imagem são baixados e analisados pelo Claude na triagem.
4. A IA atualiza o funil (`conversando → interessado → negociando → fechado/perdido`) e registra follow-up no Redrive.
5. Quando não resolve — ou quando o lead autoriza o modelo de laudo, envia a documentação completa ou quer fechar — a IA **escala para o Dioni** (texto na janela de 24h; template fora dela) e, quando apropriado, pausa o próprio atendimento.
6. No painel, qualquer usuário pode **assumir** a conversa (IA para) ou **devolver para a IA**.
7. Resposta manual pelo celular também pausa a IA naquela conversa (coexistência).

## Observações importantes

- **Janela de 24h da Meta:** o número oficial só envia mensagem livre para quem interagiu nas últimas 24h. Fora da janela, apenas template aprovado — por isso o template de escalonamento é necessário para os avisos chegarem sempre.
- **`knowledge/base.md`** é a fonte única de verdade da IA: valores, prazos, e-mail para documentos, descontos. Campos `[PREENCHER]` fazem a IA escalar em vez de inventar.
- **Ritmo de disparo:** padrão de ~10 templates/min (`DISPATCH_INTERVAL_MS`) para preservar a qualidade do número na Meta. Aumente com cautela.
- O banco local fica em `./data/atende-laudos.db` (SQLite) — faça backup.
