#!/usr/bin/env node
/**
 * Configuracao do DNS no Cloudflare (onde esta o simplificapn.com).
 *
 * Uso:
 *   CLOUDFLARE_API_TOKEN=xxx node scripts/setup-cloudflare.js status
 *   CLOUDFLARE_API_TOKEN=xxx node scripts/setup-cloudflare.js dns --ip 1.2.3.4 [--proxied]
 *
 * Comandos:
 *   status  - mostra a zona e os registros DNS atuais (destaca o subdominio)
 *   dns     - cria/atualiza o registro A vendalaudos.simplificapn.com -> IP
 *             (--proxied liga o proxy laranja do Cloudflare; sem a flag fica
 *              "DNS only", que e o modo mais simples para o Caddy emitir o
 *              certificado HTTPS sozinho no servidor)
 *
 * Token: dash.cloudflare.com -> My Profile -> API Tokens -> Create Token ->
 * modelo "Edit zone DNS" restrito a zona simplificapn.com.
 */

const API = "https://api.cloudflare.com/client/v4";
const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const ZONE_NAME = process.env.DOMAIN_ROOT || "simplificapn.com";
const SUBDOMAIN = process.env.SUBDOMAIN || "vendalaudos";
const FQDN = `${SUBDOMAIN}.${ZONE_NAME}`;

if (!TOKEN) {
  console.error(
    "Defina CLOUDFLARE_API_TOKEN (dash.cloudflare.com -> My Profile -> API Tokens -> Edit zone DNS)."
  );
  process.exit(1);
}

const args = process.argv.slice(2);
const command = args.find((a) => !a.startsWith("--")) || "status";
function flag(name) {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const next = args[i + 1];
  return next && !next.startsWith("--") ? next : true;
}

async function cf(path, { method = "GET", body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    const errs = (json.errors || []).map((e) => `${e.code}: ${e.message}`).join("; ");
    throw new Error(`${method} ${path} -> HTTP ${res.status} ${errs || JSON.stringify(json).slice(0, 200)}`);
  }
  return json.result;
}

async function getZone() {
  const zones = await cf(`/zones?name=${ZONE_NAME}`);
  if (!zones?.length) {
    throw new Error(
      `Zona ${ZONE_NAME} não encontrada — confira se o token tem acesso a essa zona.`
    );
  }
  return zones[0];
}

async function cmdStatus() {
  const zone = await getZone();
  console.log(`Zona: ${zone.name} (id ${zone.id}, status ${zone.status})`);
  const records = await cf(`/zones/${zone.id}/dns_records?per_page=100`);
  console.log(`\n== Registros DNS (${records.length}) ==`);
  for (const r of records) {
    const mark = r.name === FQDN ? " <== ALVO" : "";
    console.log(
      ` - ${r.type.padEnd(6)} ${r.name.padEnd(40)} -> ${String(r.content).slice(0, 45)} ${r.proxied ? "[proxy ☁️]" : "[DNS only]"}${mark}`
    );
  }
}

async function cmdDns() {
  const ip = flag("ip");
  if (!ip || ip === true) {
    throw new Error("Informe o IP do servidor: node scripts/setup-cloudflare.js dns --ip 1.2.3.4");
  }
  const proxied = !!flag("proxied");
  const zone = await getZone();
  const existing = await cf(`/zones/${zone.id}/dns_records?name=${FQDN}`);
  const payload = { type: "A", name: SUBDOMAIN, content: ip, ttl: 300, proxied };
  if (existing?.length) {
    await cf(`/zones/${zone.id}/dns_records/${existing[0].id}`, { method: "PUT", body: payload });
    console.log(`✅ Registro atualizado: ${FQDN} -> ${ip} ${proxied ? "[proxy ☁️]" : "[DNS only]"}`);
  } else {
    await cf(`/zones/${zone.id}/dns_records`, { method: "POST", body: payload });
    console.log(`✅ Registro criado: ${FQDN} -> ${ip} ${proxied ? "[proxy ☁️]" : "[DNS only]"}`);
  }
  if (proxied) {
    console.log(
      "⚠️  Com o proxy do Cloudflare ligado, o certificado no servidor deve ser um Origin Certificate " +
        "do Cloudflare (ou o SSL da zona em modo Full). No modo DNS only o Caddy emite o certificado sozinho."
    );
  }
}

try {
  if (command === "status") await cmdStatus();
  else if (command === "dns") await cmdDns();
  else {
    console.error(`Comando desconhecido: ${command} (use status | dns)`);
    process.exit(1);
  }
} catch (e) {
  console.error("ERRO:", e.message);
  process.exit(1);
}
