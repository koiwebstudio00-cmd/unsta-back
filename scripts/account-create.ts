import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { db } from "../src/db.js";
import { config } from "../src/config.js";
import { hashPassword } from "../src/password.js";
try {
  const email = z
    .string()
    .trim()
    .toLowerCase()
    .email()
    .max(254)
    .parse(process.argv[2]);
  if (await db.account.findUnique({ where: { email } }))
    throw new Error("La cuenta ya existe. No se modificó su contraseña.");
  const password = randomBytes(18).toString("base64url");
  const passwordHash = await hashPassword(password);
  // Save the generated secret privately before creating the account; never log it.
  mkdirSync(".local", { recursive: true });
  const file = resolve(
    ".local",
    `account-${randomBytes(8).toString("hex")}.local.json`,
  );
  writeFileSync(file, JSON.stringify({ email, password }, null, 2), {
    mode: 0o600,
    flag: "wx",
  });
  await db.$transaction(async (tx) => {
    await tx.workspace.upsert({
      where: { id: config.UNSTA_WORKSPACE_ID },
      create: { id: config.UNSTA_WORKSPACE_ID, name: "UNSTA" },
      update: {},
    });
    await tx.account.create({
      data: { email, passwordHash, workspaceId: config.UNSTA_WORKSPACE_ID },
    });
  });
  console.log(
    `Cuenta creada. Credenciales en ${file}. Guardalas en tu gestor de contraseñas; no se envió correo.`,
  );
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "No se pudo crear la cuenta",
  );
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
