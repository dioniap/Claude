import express from "express";
import {
  createSession,
  deleteSession,
  getUserByEmail,
  setUserPassword,
  verifyPassword,
} from "../db.js";
import { generateTempPassword, requireUser } from "../auth.js";
import { sendTempPasswordEmail } from "../mailer.js";

export const authRouter = express.Router();

/** Login por e-mail e senha. */
authRouter.post("/login", (req, res) => {
  const { email, senha } = req.body || {};
  if (!email || !senha) {
    return res.status(400).json({ error: "informe email e senha" });
  }
  const user = getUserByEmail(email);
  if (!user || !verifyPassword(senha, user.password_hash)) {
    return res.status(401).json({ error: "e-mail ou senha incorretos" });
  }
  const token = createSession(user.id);
  res.json({
    token,
    user: { id: user.id, name: user.name, email: user.email },
    mustChangePassword: !!user.must_change_password,
  });
});

authRouter.post("/logout", requireUser, (req, res) => {
  deleteSession(req.sessionToken);
  res.json({ ok: true });
});

authRouter.get("/me", requireUser, (req, res) => {
  res.json({
    user: { id: req.user.id, name: req.user.name, email: req.user.email },
    mustChangePassword: !!req.user.must_change_password,
  });
});

/**
 * Esqueci minha senha: gera senha provisoria, envia por e-mail (Hostinger)
 * e marca a conta para troca obrigatoria no proximo acesso.
 */
authRouter.post("/forgot", async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: "informe o e-mail" });
  const user = getUserByEmail(email);
  // resposta generica para nao revelar quais e-mails existem
  const generic = {
    ok: true,
    message: "Se o e-mail estiver cadastrado, a senha provisória foi enviada.",
  };
  if (!user) return res.json(generic);
  const temp = generateTempPassword();
  try {
    await sendTempPasswordEmail(user.email, user.name, temp);
  } catch (e) {
    console.error("[auth] falha ao enviar e-mail de senha provisoria:", e.message);
    return res
      .status(500)
      .json({ error: "não foi possível enviar o e-mail — verifique a configuração SMTP" });
  }
  // so troca a senha depois que o e-mail saiu com sucesso
  setUserPassword(user.id, temp, true);
  res.json(generic);
});

/**
 * Troca de senha. Quando a conta esta com senha provisoria
 * (must_change_password), a senha atual nao e exigida.
 */
authRouter.post("/change-password", requireUser, (req, res) => {
  const { senhaAtual, novaSenha } = req.body || {};
  if (!novaSenha || String(novaSenha).length < 8) {
    return res.status(400).json({ error: "a nova senha precisa ter pelo menos 8 caracteres" });
  }
  if (!req.user.must_change_password) {
    if (!senhaAtual || !verifyPassword(senhaAtual, req.user.password_hash)) {
      return res.status(401).json({ error: "senha atual incorreta" });
    }
  }
  setUserPassword(req.user.id, novaSenha, false);
  res.json({ ok: true });
});
