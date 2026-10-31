import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { newInvite } from "../src/auth.js";
import { db } from "../src/db.js";
const email = z
  .string()
  .email()
  .parse(process.argv[2] ?? "evaluador@example.test");
const result = await newInvite(email);
const folder = resolve(".local") + "/";
mkdirSync(folder, { recursive: true });
// Multiple invitations now share a workspace: never overwrite another invite.
const file =
  folder + `invite-${result.workspace.id}-${randomUUID()}.local.json`;
writeFileSync(
  file,
  JSON.stringify(
    {
      workspace_id: result.workspace.id,
      email,
      token: result.token,
      expires_in_hours: 24,
    },
    null,
    2,
  ),
  { mode: 0o600 },
);
console.log(`Invitación creada en ${file}. No se envió correo.`);
await db.$disconnect();
