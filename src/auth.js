import crypto from "node:crypto";
import { config } from "./config.js";
import { getSession, getUserById } from "./db.js";

/** Extrai o usuario logado a partir do header Authorization: Bearer <token>. */
export function userFromRequest(req) {
  const auth = req.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;
  const token = auth.slice(7).trim();
  const session = getSession(token);
  if (!session) return null;
  const user = getUserById(session.user_id);
  if (!user) return null;
  return { user, token };
}

/** Middleware: exige usuario logado no painel. */
export function requireUser(req, res, next) {
  const found = userFromRequest(req);
  if (!found) return res.status(401).json({ error: "sessão inválida — faça login" });
  req.user = found.user;
  req.sessionToken = found.token;
  next();
}

/**
 * Middleware: aceita usuario logado do painel OU o ADMIN_TOKEN
 * (para scripts/integracoes externas).
 */
export function requireUserOrAdminToken(req, res, next) {
  const auth = req.get("authorization") || "";
  if (config.adminToken && auth === `Bearer ${config.adminToken}`) {
    req.user = { id: 0, name: "admin-token", email: null };
    return next();
  }
  const found = userFromRequest(req);
  if (found) {
    req.user = found.user;
    req.sessionToken = found.token;
    return next();
  }
  if (!config.adminToken) return next(); // sem ADMIN_TOKEN configurado, rotas ficam abertas (dev)
  return res.status(401).json({ error: "não autorizado" });
}

/** Senha provisoria legivel (8 caracteres, sem ambiguos). */
export function generateTempPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < 8; i++) {
    out += alphabet[crypto.randomInt(alphabet.length)];
  }
  return out;
}
