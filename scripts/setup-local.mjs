import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync, chmodSync } from "node:fs";
const path = new URL("../.env.local", import.meta.url);
if (existsSync(path)) {
  console.log(".env.local ya existe; no se modificó.");
  process.exit(0);
}
const owner = randomBytes(24).toString("hex"),
  rt = randomBytes(24).toString("hex");
writeFileSync(
  path,
  `DATABASE_URL=postgresql://unsta_rt:${rt}@127.0.0.1:55432/unsta_demo\nMIGRATION_DATABASE_URL=postgresql://unsta_owner:${owner}@127.0.0.1:55432/unsta_demo\nPOSTGRES_PASSWORD=${owner}\nRUNTIME_DB_PASSWORD=${rt}\nAGENT_SERVICE_KEY=${randomBytes(32).toString("hex")}\nN8N_WEBHOOK_KEY=${randomBytes(32).toString("hex")}\nN8N_CONVERSATION_URL=\nN8N_OPENING_URL=\nPORT=4100\nHOST=127.0.0.1\nPANEL_ORIGIN=http://localhost:3000\nCOOKIE_SECURE=false\nDISPATCH_ENABLED=false\n`,
  { mode: 0o600 },
);
chmodSync(path, 0o600);
console.log(
  "Configuración local creada. Secretos no mostrados. Despacho a n8n apagado.",
);
