import { config } from "./config.js";

/**
 * Integracao com o G-Click (solicitacoes do setor de Laudos Periciais).
 *
 * As credenciais e (se necessario) os caminhos dos endpoints devem ser copiados
 * do sistema omnichannel da Simplifica, onde a integracao ja esta em uso:
 *   GCLICK_BASE_URL, GCLICK_AUTH_URL, GCLICK_CLIENT_ID, GCLICK_CLIENT_SECRET,
 *   GCLICK_USER, GCLICK_PASS, GCLICK_EMP_ID, GCLICK_SOLICITACOES_PATH
 *
 * Autenticacao: OAuth2 (client_credentials ou password, conforme o que estiver
 * configurado). O token e cacheado ate perto de expirar.
 */

let cachedToken = null;
let cachedTokenExpiresAt = 0;

export function gclickEnabled() {
  const g = config.gclick;
  return !!(g.clientId || g.user);
}

async function fetchToken() {
  const g = config.gclick;
  const authUrl = g.authUrl || `${g.baseUrl}/oauth/token`;

  const params = new URLSearchParams();
  if (g.user && g.pass) {
    params.set("grant_type", "password");
    params.set("username", g.user);
    params.set("password", g.pass);
  } else {
    params.set("grant_type", "client_credentials");
  }

  const headers = { "Content-Type": "application/x-www-form-urlencoded" };
  if (g.clientId) {
    headers.Authorization =
      "Basic " + Buffer.from(`${g.clientId}:${g.clientSecret}`).toString("base64");
  }

  const res = await fetch(authUrl, { method: "POST", headers, body: params });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) {
    throw new Error(
      `G-Click auth falhou (HTTP ${res.status}): ${JSON.stringify(json).slice(0, 300)}`
    );
  }
  cachedToken = json.access_token;
  const ttl = (json.expires_in || 3600) * 1000;
  cachedTokenExpiresAt = Date.now() + ttl - 60_000;
  return cachedToken;
}

async function getToken() {
  if (cachedToken && Date.now() < cachedTokenExpiresAt) return cachedToken;
  return fetchToken();
}

async function gclickRequest(pathSegment, { method = "GET", query, raw = false } = {}) {
  if (!gclickEnabled()) {
    const err = new Error(
      "G-Click não configurado — copie as credenciais do sistema omnichannel para o .env (GCLICK_*)"
    );
    err.notConfigured = true;
    throw err;
  }
  const token = await getToken();
  const url = new URL(`${config.gclick.baseUrl}${pathSegment}`);
  for (const [k, v] of Object.entries(query || {})) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
  }
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) {
    // token expirado/invalidado - renova uma vez
    cachedToken = null;
    const retryToken = await getToken();
    const retry = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${retryToken}` },
    });
    if (!retry.ok) throw new Error(`G-Click ${pathSegment}: HTTP ${retry.status}`);
    return raw ? retry : retry.json();
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`G-Click ${pathSegment}: HTTP ${res.status} ${body.slice(0, 300)}`);
  }
  return raw ? res : res.json();
}

/**
 * Lista solicitacoes com filtros do painel:
 * cliente, descricao, inicioDe/inicioAte (prazo de inicio),
 * metaDe/metaAte (prazo meta), vencimentoDe/vencimentoAte, pagina.
 */
export async function listSolicitacoes(filters = {}) {
  const g = config.gclick;
  return gclickRequest(g.solicitacoesPath, {
    query: {
      empId: g.empId,
      cliente: filters.cliente,
      descricao: filters.descricao,
      inicioDe: filters.inicioDe,
      inicioAte: filters.inicioAte,
      metaDe: filters.metaDe,
      metaAte: filters.metaAte,
      vencimentoDe: filters.vencimentoDe,
      vencimentoAte: filters.vencimentoAte,
      pagina: filters.pagina || 1,
    },
  });
}

export async function getSolicitacao(id) {
  const g = config.gclick;
  return gclickRequest(`${g.solicitacoesPath}/${id}`, { query: { empId: g.empId } });
}

/** Documentos/anexos das tarefas de uma solicitacao. */
export async function listDocumentos(solicitacaoId) {
  const g = config.gclick;
  return gclickRequest(`${g.solicitacoesPath}/${solicitacaoId}/anexos`, {
    query: { empId: g.empId },
  });
}

/** Faz o download de um anexo (retorna o Response cru para stream/proxy). */
export async function downloadDocumento(solicitacaoId, anexoId) {
  const g = config.gclick;
  return gclickRequest(`${g.solicitacoesPath}/${solicitacaoId}/anexos/${anexoId}`, {
    query: { empId: g.empId },
    raw: true,
  });
}
