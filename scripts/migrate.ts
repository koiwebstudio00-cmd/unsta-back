import "../src/config.js";
import { PrismaClient } from "@prisma/client";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
const ownerUrl = process.env.MIGRATION_DATABASE_URL;
const password = process.env.RUNTIME_DB_PASSWORD;
if (!ownerUrl || !password || !/^[a-f0-9]{48,128}$/.test(password))
  throw new Error("Configuración de migración local faltante/inválida");
const p = spawnSync(
  process.execPath,
  [
    join(dirname(createRequire(import.meta.url).resolve("prisma/package.json")), "build/index.js"),
    "migrate",
    "deploy",
    "--schema",
    fileURLToPath(new URL("../prisma/schema.prisma", import.meta.url)),
  ],
  { env: { ...process.env, DATABASE_URL: ownerUrl }, stdio: "inherit" },
);
if (p.status !== 0) process.exit(p.status ?? 1);
const owner = new PrismaClient({ datasources: { db: { url: ownerUrl } } });
try {
  const exists = await owner.$queryRaw<
    { exists: boolean }[]
  >`SELECT EXISTS(SELECT FROM pg_roles WHERE rolname='unsta_rt')`;
  if (!exists[0].exists)
    await owner.$executeRawUnsafe(
      "CREATE ROLE unsta_rt LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE",
    );
  // Password limited to generated hex above; never logged. Prisma cannot bind DDL identifiers/passwords.
  await owner.$executeRawUnsafe(`ALTER ROLE unsta_rt PASSWORD '${password}'`);
  await owner.$executeRawUnsafe("GRANT USAGE ON SCHEMA public TO unsta_rt");
  await owner.$executeRawUnsafe(
    "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO unsta_rt",
  );
  await owner.$executeRawUnsafe(
    'REVOKE ALL ON "_prisma_migrations" FROM unsta_rt',
  );
  console.log("Migraciones y permisos runtime aplicados.");
} finally {
  await owner.$disconnect();
}
