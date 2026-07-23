#!/usr/bin/env node
/**
 * Configuracao automatica na Hostinger via API oficial (developers.hostinger.com).
 *
 * Uso:
 *   HOSTINGER_API_TOKEN=xxx node scripts/setup-hostinger.js status
 *   HOSTINGER_API_TOKEN=xxx node scripts/setup-hostinger.js dns [--ip 1.2.3.4]
 *   HOSTINGER_API_TOKEN=xxx node scripts/setup-hostinger.js deploy [--vm <id>] [--env-file .env]
 *   HOSTINGER_API_TOKEN=xxx node scripts/setup-hostinger.js all
 *
 * Comandos:
 *   status  - lista os VPS da conta e os registros DNS atuais do subdominio
 *   dns     - cria/atualiza o registro A vendalaudos.simplificapn.com -> IP do VPS
 *   deploy  - cria o projeto Docker Compose "atende-laudos" no VPS (API Docker Manager)
 *   all     - dns + deploy
 *
 * O token e criado no hPanel: perfil -> Conta -> API -> Novo token.
 */

import fs from "node:fs";

const API = "https://developers.hostinger.com";
const TOKEN = process.env.HOSTINGER_API_TOKEN;
const DOMAIN = process.env.DOMAIN_ROOT || "simplificapn.com";
const SUBDOMAIN = process.env.SUBDOMAIN || "vendalaudos";
const REPO_URL =
  process.env.DEPLOY_REPO_URL ||
  "https://github.com/dioniap/Claude/tree/claude/whatsapp-ai-laudo-leads-tviuxz";
const PROJECT_NAME = "atende-laudos";

if (!TOKEN) {
  console.error("Defina HOSTINGER_API_TOKEN (hPanel -> Conta -> API -> Novo token).");
  process.exit(1);
}

const args = process.argv.slice(2);
const command = args.find((a) => !a.startsWith("--")) || "status";
function flag(name) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`${method} ${path} -> HTTP ${res.status}: ${text.slice(0, 400)}`);
  }
  return json;
}

function vmIp(vm) {
  const ip4 = vm?.ipv4;
  if (Array.isArray(ip4) && ip4.length) return ip4[0].address || ip4[0].ip || null;
  if (typeof ip4 === "string") return ip4;
  return vm?.ip_address || null;
}

async function listVms() {
  const data = await api("/api/vps/v1/virtual-machines");
  return Array.isArray(data) ? data : data?.data || [];
}

async function pickVm() {
  const vms = await listVms();
  if (!vms.length) {
    throw new Error(
      "Nenhum VPS encontrado na conta Hostinger. Contrate um VPS (hpanel.hostinger.com -> VPS) e rode de novo."
    );
  }
  const wanted = flag("vm");
  const vm = wanted ? vms.find((v) => String(v.id) === String(wanted)) : vms[0];
  if (!vm) throw new Error(`VPS ${wanted} não encontrado.`);
  return vm;
}

async function cmdStatus() {
  console.log(`== VPS da conta ==`);
  const vms = await listVms();
  if (!vms.length) console.log("(nenhum VPS - contrate um no hPanel)");
  for (const vm of vms) {
    console.log(
      ` - id=${vm.id} hostname=${vm.hostname || "-"} estado=${vm.state || vm.status || "-"} ip=${vmIp(vm) || "-"}`
    );
  }
  console.log(`\n== Registros DNS de ${DOMAIN} (filtrando "${SUBDOMAIN}") ==`);
  const zone = await api(`/api/dns/v1/zones/${DOMAIN}`);
  const records = Array.isArray(zone) ? zone : zone?.data || [];
  const match = records.filter((r) => r.name === SUBDOMAIN);
  if (!match.length) console.log(`(nenhum registro "${SUBDOMAIN}" ainda)`);
  for (const r of match) {
    console.log(` - ${r.name} ${r.type} ttl=${r.ttl} -> ${JSON.stringify(r.records)}`);
  }
}

async function cmdDns() {
  let ip = flag("ip");
  if (!ip) {
    const vm = await pickVm();
    ip = vmIp(vm);
    if (!ip) throw new Error(`VPS ${vm.id} não tem IPv4 visível; informe --ip manualmente.`);
    console.log(`Usando IP do VPS ${vm.id} (${vm.hostname || "sem hostname"}): ${ip}`);
  }
  await api(`/api/dns/v1/zones/${DOMAIN}`, {
    method: "PUT",
    body: {
      overwrite: true, // substitui registro A "vendalaudos" existente, se houver
      zone: [
        {
          name: SUBDOMAIN,
          type: "A",
          ttl: 300,
          records: [{ content: ip }],
        },
      ],
    },
  });
  console.log(`✅ DNS configurado: ${SUBDOMAIN}.${DOMAIN} -> ${ip} (TTL 300)`);
}

async function cmdDeploy() {
  const vm = await pickVm();
  const envFile = flag("env-file") || ".env";
  let environment = "";
  if (fs.existsSync(envFile)) {
    environment = fs.readFileSync(envFile, "utf-8");
    console.log(`Usando variáveis de ${envFile} (${environment.split("\n").length} linhas).`);
  } else {
    console.warn(
      `⚠️  ${envFile} não encontrado — o projeto sobe sem variáveis e as integrações não funcionam.`
    );
  }
  console.log(`Criando projeto Docker "${PROJECT_NAME}" no VPS ${vm.id} a partir de:\n  ${REPO_URL}`);
  const result = await api(`/api/vps/v1/virtual-machines/${vm.id}/docker`, {
    method: "POST",
    body: {
      project_name: PROJECT_NAME,
      content: REPO_URL,
      ...(environment ? { environment } : {}),
    },
  });
  console.log("✅ Projeto criado/enviado. Resposta:", JSON.stringify(result).slice(0, 300));
  console.log(
    `Acompanhe: node scripts/setup-hostinger.js status  (ou hPanel -> VPS -> Docker Manager)`
  );
}

try {
  if (command === "status") await cmdStatus();
  else if (command === "dns") await cmdDns();
  else if (command === "deploy") await cmdDeploy();
  else if (command === "all") {
    await cmdDns();
    await cmdDeploy();
  } else {
    console.error(`Comando desconhecido: ${command} (use status | dns | deploy | all)`);
    process.exit(1);
  }
} catch (e) {
  console.error("ERRO:", e.message);
  process.exit(1);
}
