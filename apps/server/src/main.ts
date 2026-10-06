import { createServer } from "node:http";
import { loadConfig } from "./config.ts";
import { createApp } from "./app.ts";

const cfg = loadConfig();
const app = createApp(cfg);
const server = createServer({ requestTimeout: 120_000, headersTimeout: 15_000, maxHeaderSize: 16_384 }, (req, res) => void app.handle(req, res));
server.listen(cfg.port, () => console.log(`VSV API on :${cfg.port}`));
setInterval(app.housekeeping, 10 * 60_000).unref();
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => server.close(() => { app.db.close(); process.exit(0); }));
