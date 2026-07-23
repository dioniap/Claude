import express from "express";
import { assertConfig, config } from "./config.js";
import { webhookRouter } from "./routes/webhook.js";
import { adminRouter } from "./routes/admin.js";

assertConfig();

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

app.get("/", (req, res) => {
  res.json({ app: "atende-laudos", ok: true });
});

app.use(webhookRouter);
app.use("/api", adminRouter);

app.listen(config.port, () => {
  console.log(`[server] atende-laudos ouvindo na porta ${config.port}`);
  console.log(`[server] webhook Meta: GET/POST /webhook`);
  console.log(`[server] admin API:    /api/* (health, leads, dispatch, conversations)`);
});
