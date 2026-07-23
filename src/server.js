import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertConfig, config } from "./config.js";
import { webhookRouter } from "./routes/webhook.js";
import { adminRouter } from "./routes/admin.js";
import { authRouter } from "./routes/auth.js";
import { panelRouter } from "./routes/panel.js";

assertConfig();

const here = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// Guarda o corpo bruto para validar a assinatura X-Hub-Signature-256 da Meta
app.use(
  express.json({
    limit: "5mb",
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  })
);

// Painel de atendimento (SPA em /)
app.use(express.static(path.join(here, "..", "public")));

app.use(webhookRouter);
app.use("/auth", authRouter);
app.use("/panel", panelRouter);
app.use("/api", adminRouter);

app.listen(config.port, () => {
  console.log(`[server] atende-laudos ouvindo na porta ${config.port}`);
  console.log(`[server] painel:       http://localhost:${config.port}/`);
  console.log(`[server] webhook Meta: GET/POST /webhook`);
  console.log(`[server] painel API:   /auth/*, /panel/*`);
  console.log(`[server] admin API:    /api/* (health, leads, dispatch)`);
});
