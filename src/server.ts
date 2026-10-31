import { createApp } from "./app.js";
import { config } from "./config.js";
import { db, checkRuntimeRole } from "./db.js";
import { importKnowledge } from "./knowledge.js";
import { startWorker } from "./worker.js";
await checkRuntimeRole();
await importKnowledge();
const stop = startWorker();
const server = createApp().listen(config.PORT, config.HOST, () =>
  console.log(
    `API UNSTA en http://${config.HOST}:${config.PORT} · despacho n8n ${config.DISPATCH_ENABLED === "true" ? "activo" : "apagado"}`,
  ),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    stop();
    server.close(() => {
      void db.$disconnect().then(() => process.exit(0));
    });
  });
