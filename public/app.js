/* ===== Painel de Atendimento — Simplifica Laudos ===== */

let token = localStorage.getItem("al_token") || null;
let me = null;
let users = [];
let currentFilter = "all";
let currentPhone = null;
let currentInternalUser = null;
let pollTimers = [];

const $ = (id) => document.getElementById(id);

// ---------- fetch com sessao ----------
async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (options.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  const res = await fetch(path, { ...options, headers });
  if (res.status === 401 && !path.startsWith("/auth/login")) {
    logoutLocal();
    throw new Error("sessão expirada");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ---------- telas ----------
function show(screen) {
  ["screen-login", "screen-change-pass", "screen-app"].forEach((s) =>
    $(s).classList.toggle("hidden", s !== screen)
  );
}

function logoutLocal() {
  token = null;
  me = null;
  localStorage.removeItem("al_token");
  stopPolling();
  show("screen-login");
}

// ---------- login ----------
$("btn-login").onclick = async () => {
  const email = $("login-email").value.trim();
  const senha = $("login-senha").value;
  $("login-error").classList.add("hidden");
  try {
    const data = await api("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, senha }),
    });
    token = data.token;
    localStorage.setItem("al_token", token);
    me = data.user;
    if (data.mustChangePassword) {
      show("screen-change-pass");
    } else {
      enterApp();
    }
  } catch (e) {
    $("login-error").textContent = e.message;
    $("login-error").classList.remove("hidden");
  }
};
$("login-senha").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("btn-login").click();
});

$("btn-show-forgot").onclick = () => {
  $("login-form").classList.add("hidden");
  $("forgot-form").classList.remove("hidden");
};
$("btn-back-login").onclick = () => {
  $("forgot-form").classList.add("hidden");
  $("login-form").classList.remove("hidden");
};
$("btn-forgot").onclick = async () => {
  const email = $("forgot-email").value.trim();
  const box = $("forgot-msg");
  box.classList.remove("hidden");
  box.textContent = "Enviando...";
  try {
    const data = await api("/auth/forgot", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
    box.textContent = data.message || "Enviado! Confira seu e-mail.";
  } catch (e) {
    box.textContent = "Erro: " + e.message;
  }
};

$("btn-change-pass").onclick = async () => {
  const p1 = $("new-pass").value;
  const p2 = $("new-pass2").value;
  const err = $("change-error");
  err.classList.add("hidden");
  if (p1.length < 8) {
    err.textContent = "A senha precisa ter pelo menos 8 caracteres.";
    err.classList.remove("hidden");
    return;
  }
  if (p1 !== p2) {
    err.textContent = "As senhas não conferem.";
    err.classList.remove("hidden");
    return;
  }
  try {
    await api("/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ novaSenha: p1 }),
    });
    enterApp();
  } catch (e) {
    err.textContent = e.message;
    err.classList.remove("hidden");
  }
};

$("btn-logout").onclick = async () => {
  try { await api("/auth/logout", { method: "POST" }); } catch {}
  logoutLocal();
};

// ---------- app ----------
async function enterApp() {
  const meData = await api("/auth/me");
  me = meData.user;
  $("me-name").textContent = `👤 ${me.name}`;
  users = await api("/panel/users");
  buildFilterChips();
  buildInternalUserList();
  show("screen-app");
  switchTab("conversas");
  startPolling();
  refreshConversations();
  refreshUnread();
  checkGclick();
}

// tabs
document.querySelectorAll(".nav-btn").forEach((btn) => {
  btn.onclick = () => switchTab(btn.dataset.tab);
});
function switchTab(tab) {
  document.querySelectorAll(".nav-btn").forEach((b) =>
    b.classList.toggle("active", b.dataset.tab === tab)
  );
  ["conversas", "interno", "gclick"].forEach((t) =>
    $(`tab-${t}`).classList.toggle("hidden", t !== tab)
  );
}

function startPolling() {
  stopPolling();
  pollTimers.push(setInterval(refreshConversations, 5000));
  pollTimers.push(setInterval(() => { if (currentPhone) openConversation(currentPhone, true); }, 4000));
  pollTimers.push(setInterval(() => { if (currentInternalUser) openInternal(currentInternalUser, true); }, 4000));
  pollTimers.push(setInterval(refreshUnread, 6000));
}
function stopPolling() {
  pollTimers.forEach(clearInterval);
  pollTimers = [];
}

// ---------- conversas ----------
function buildFilterChips() {
  const box = $("conv-filters");
  box.innerHTML = "";
  const chips = [
    { key: "all", label: "Todas" },
    { key: "ia", label: "Com a IA" },
    ...users.map((u) => ({
      key: `user:${u.id}`,
      label: u.id === me.id ? "Comigo" : `Com ${u.name}`,
    })),
  ];
  for (const c of chips) {
    const el = document.createElement("button");
    el.className = "chip" + (currentFilter === c.key ? " active" : "");
    el.textContent = c.label;
    el.onclick = () => {
      currentFilter = c.key;
      buildFilterChips();
      refreshConversations();
    };
    box.appendChild(el);
  }
}

async function refreshConversations() {
  try {
    const convs = await api(`/panel/conversations?filter=${encodeURIComponent(currentFilter)}`);
    const list = $("conv-list");
    list.innerHTML = "";
    if (!convs.length) {
      list.innerHTML = '<div class="empty-note" style="padding:20px 16px">Nenhuma conversa neste filtro.</div>';
      return;
    }
    for (const c of convs) {
      const item = document.createElement("div");
      item.className = "conv-item" + (c.phone === currentPhone ? " active" : "");
      const tag = tagFor(c);
      item.innerHTML = `
        <div class="conv-top">
          <span class="conv-name">${esc(c.lead_name || "+" + c.phone)}</span>
          <span class="conv-tag ${tag.cls}">${tag.label}</span>
        </div>
        <div class="conv-preview">${esc(c.last_message || "")}</div>
        <div class="conv-sub">+${c.phone}${c.lead_status ? " · " + c.lead_status : ""}</div>`;
      item.onclick = () => openConversation(c.phone);
      list.appendChild(item);
    }
  } catch (e) {
    console.warn("refreshConversations:", e.message);
  }
}

function tagFor(c) {
  if (c.assigned_to) {
    return { cls: "tag-humana", label: c.assigned_name || "humano" };
  }
  if (c.status === "pausada") return { cls: "tag-pausada", label: "pausada" };
  if (c.status === "escalada") return { cls: "tag-escalada", label: "escalada" };
  return { cls: "tag-ia", label: "IA" };
}

async function openConversation(phone, silent = false) {
  currentPhone = phone;
  if (!silent) refreshConversations();
  try {
    const data = await api(`/panel/conversations/${phone}/messages`);
    $("thread-empty").classList.add("hidden");
    $("thread").classList.remove("hidden");
    $("thread-name").textContent = data.lead?.name || `+${phone}`;
    $("thread-meta").textContent = `+${phone}${data.lead?.status ? " · funil: " + data.lead.status : ""}`;
    const box = $("thread-messages");
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
    box.innerHTML = "";
    for (const m of data.messages) {
      box.appendChild(renderMessage(m));
    }
    if (atBottom || !silent) box.scrollTop = box.scrollHeight;
    $("composer-hint").textContent =
      "Ao enviar, você fala com o lead pelo número oficial. Fora da janela de 24h a Meta só aceita template.";
  } catch (e) {
    console.warn("openConversation:", e.message);
  }
}

function renderMessage(m) {
  const div = document.createElement("div");
  if (m.role === "system") {
    div.className = "msg msg-system";
    div.textContent = m.content;
    return div;
  }
  const isOut = m.role === "assistant";
  div.className = "msg " + (isOut ? "msg-out" : "msg-lead");
  const sender = isOut
    ? m.sender === "ia"
      ? "🤖 IA"
      : m.sender === "celular"
      ? "📱 Celular"
      : m.sender
      ? `👤 ${m.sender}`
      : ""
    : "";
  div.innerHTML =
    (sender ? `<div class="msg-sender">${esc(sender)}</div>` : "") +
    `<div>${esc(m.content)}</div>` +
    `<div class="msg-time">${(m.created_at || "").slice(11, 16)}</div>`;
  return div;
}

$("btn-assume").onclick = async () => {
  if (!currentPhone) return;
  await api(`/panel/conversations/${currentPhone}/assume`, { method: "POST" });
  openConversation(currentPhone);
};
$("btn-return-ia").onclick = async () => {
  if (!currentPhone) return;
  await api(`/panel/conversations/${currentPhone}/return-to-ia`, { method: "POST" });
  openConversation(currentPhone);
};
$("btn-send").onclick = sendToLead;
$("composer-text").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendToLead();
  }
});
async function sendToLead() {
  const text = $("composer-text").value.trim();
  if (!text || !currentPhone) return;
  try {
    await api(`/panel/conversations/${currentPhone}/send`, {
      method: "POST",
      body: JSON.stringify({ text }),
    });
    $("composer-text").value = "";
    openConversation(currentPhone);
  } catch (e) {
    alert("Erro ao enviar: " + e.message);
  }
}

// ---------- chat interno ----------
function buildInternalUserList() {
  const list = $("internal-users");
  list.innerHTML = "";
  for (const u of users.filter((u) => u.id !== me.id)) {
    const item = document.createElement("div");
    item.className = "conv-item" + (currentInternalUser === u.id ? " active" : "");
    item.dataset.userId = u.id;
    item.innerHTML = `
      <div class="conv-top">
        <span class="conv-name">${esc(u.name)}</span>
        <span class="badge hidden" id="unread-${u.id}"></span>
      </div>
      <div class="conv-sub">${esc(u.email)}</div>`;
    item.onclick = () => openInternal(u.id);
    list.appendChild(item);
  }
}

async function refreshUnread() {
  try {
    const counts = await api("/panel/internal/unread");
    let total = 0;
    document.querySelectorAll("[id^='unread-']").forEach((el) => el.classList.add("hidden"));
    for (const c of counts) {
      total += c.total;
      const el = $(`unread-${c.from_user}`);
      if (el) {
        el.textContent = c.total;
        el.classList.remove("hidden");
      }
    }
    const badge = $("badge-interno");
    if (total > 0) {
      badge.textContent = total;
      badge.classList.remove("hidden");
    } else {
      badge.classList.add("hidden");
    }
  } catch (e) {
    console.warn("refreshUnread:", e.message);
  }
}

async function openInternal(userId, silent = false) {
  currentInternalUser = userId;
  if (!silent) buildInternalUserList();
  const other = users.find((u) => u.id === userId);
  try {
    const msgs = await api(`/panel/internal/${userId}/messages`);
    $("internal-empty").classList.add("hidden");
    $("internal-thread").classList.remove("hidden");
    $("internal-name").textContent = other ? other.name : `Usuário ${userId}`;
    const box = $("internal-messages");
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
    box.innerHTML = "";
    for (const m of msgs) {
      const div = document.createElement("div");
      const mine = m.from_user === me.id;
      div.className = "msg " + (mine ? "msg-out" : "msg-lead");
      div.innerHTML =
        `<div>${esc(m.content)}</div>` +
        `<div class="msg-time">${(m.created_at || "").slice(11, 16)}</div>`;
      box.appendChild(div);
    }
    if (atBottom || !silent) box.scrollTop = box.scrollHeight;
    refreshUnread();
  } catch (e) {
    console.warn("openInternal:", e.message);
  }
}

$("btn-internal-send").onclick = sendInternal;
$("internal-text").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendInternal();
  }
});
async function sendInternal() {
  const text = $("internal-text").value.trim();
  if (!text || !currentInternalUser) return;
  await api(`/panel/internal/${currentInternalUser}/messages`, {
    method: "POST",
    body: JSON.stringify({ content: text }),
  });
  $("internal-text").value = "";
  openInternal(currentInternalUser);
}

// ---------- G-Click ----------
async function checkGclick() {
  try {
    const st = await api("/panel/gclick/status");
    $("gclick-not-configured").classList.toggle("hidden", st.configured);
  } catch {}
}

$("gclick-filters").addEventListener("submit", async (e) => {
  e.preventDefault();
  const params = new URLSearchParams();
  const map = {
    cliente: "gc-cliente",
    descricao: "gc-descricao",
    inicioDe: "gc-inicio-de",
    inicioAte: "gc-inicio-ate",
    metaDe: "gc-meta-de",
    metaAte: "gc-meta-ate",
    vencimentoDe: "gc-venc-de",
    vencimentoAte: "gc-venc-ate",
  };
  for (const [param, id] of Object.entries(map)) {
    const v = $(id).value.trim();
    if (v) params.set(param, v);
  }
  const box = $("gclick-results");
  box.innerHTML = '<div class="empty-note">Buscando...</div>';
  try {
    const data = await api(`/panel/gclick/solicitacoes?${params}`);
    renderGclickResults(data);
  } catch (err) {
    box.innerHTML = `<div class="gclick-warn">Erro: ${esc(err.message)}</div>`;
  }
});

function renderGclickResults(data) {
  const rows = Array.isArray(data) ? data : data?.data || data?.solicitacoes || data?.content || [];
  const box = $("gclick-results");
  if (!rows.length) {
    box.innerHTML = '<div class="empty-note">Nenhuma solicitação encontrada com esses filtros.</div>';
    return;
  }
  const table = document.createElement("table");
  table.className = "gclick-table";
  table.innerHTML = `<thead><tr>
    <th>Cliente</th><th>Descrição</th><th>Início</th><th>Meta</th><th>Vencimento</th><th>Status</th><th></th>
  </tr></thead>`;
  const tbody = document.createElement("tbody");
  for (const r of rows) {
    const id = r.id || r.solicitacaoId || r.codigo;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${esc(r.cliente?.nome || r.clienteNome || r.cliente || "")}</td>
      <td>${esc(r.descricao || r.titulo || r.assunto || "")}</td>
      <td>${esc(fmtDate(r.inicio || r.dataInicio || r.prazoInicio))}</td>
      <td>${esc(fmtDate(r.meta || r.dataMeta || r.prazoMeta))}</td>
      <td>${esc(fmtDate(r.vencimento || r.dataVencimento || r.prazoVencimento))}</td>
      <td>${esc(r.status || r.situacao || "")}</td>
      <td><button class="doc-btn">📎 documentos</button></td>`;
    tr.querySelector(".doc-btn").onclick = () => toggleDocs(tr, id);
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  box.innerHTML = "";
  box.appendChild(table);
}

async function toggleDocs(tr, id) {
  const existing = tr.nextElementSibling;
  if (existing && existing.classList.contains("docs-row")) {
    existing.remove();
    return;
  }
  const row = document.createElement("tr");
  row.className = "docs-row";
  const td = document.createElement("td");
  td.colSpan = 7;
  td.innerHTML = '<div class="gclick-docs">Carregando documentos...</div>';
  row.appendChild(td);
  tr.after(row);
  try {
    const docs = await api(`/panel/gclick/solicitacoes/${id}/documentos`);
    const list = Array.isArray(docs) ? docs : docs?.data || docs?.anexos || [];
    if (!list.length) {
      td.innerHTML = '<div class="gclick-docs">Sem documentos nesta solicitação.</div>';
      return;
    }
    const div = document.createElement("div");
    div.className = "gclick-docs";
    for (const d of list) {
      const docId = d.id || d.anexoId || d.codigo;
      const name = d.nome || d.arquivo || d.filename || `documento ${docId}`;
      const a = document.createElement("a");
      a.href = "#";
      a.textContent = `⬇️ ${name}`;
      a.style.display = "block";
      a.style.margin = "4px 0";
      a.onclick = async (e) => {
        e.preventDefault();
        await downloadDoc(id, docId, name);
      };
      div.appendChild(a);
    }
    td.innerHTML = "";
    td.appendChild(div);
  } catch (e) {
    td.innerHTML = `<div class="gclick-docs">Erro: ${esc(e.message)}</div>`;
  }
}

async function downloadDoc(solicitacaoId, anexoId, name) {
  const res = await fetch(
    `/panel/gclick/solicitacoes/${solicitacaoId}/documentos/${anexoId}/download`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) {
    alert("Erro ao baixar documento");
    return;
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------- util ----------
function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
function fmtDate(d) {
  if (!d) return "";
  const s = String(d);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10).split("-").reverse().join("/");
  return s;
}

// ---------- boot ----------
(async function boot() {
  if (token) {
    try {
      const meData = await api("/auth/me");
      me = meData.user;
      if (meData.mustChangePassword) {
        show("screen-change-pass");
      } else {
        await enterApp();
      }
      return;
    } catch {
      logoutLocal();
    }
  }
  show("screen-login");
})();
