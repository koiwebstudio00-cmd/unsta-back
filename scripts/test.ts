import "../src/config.js";
import { PrismaClient } from "@prisma/client";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const ownerUrl = new URL(process.env.MIGRATION_DATABASE_URL!);
const runtimeUrl = new URL(process.env.DATABASE_URL!);
if (
  !["127.0.0.1", "localhost"].includes(ownerUrl.hostname) ||
  ownerUrl.pathname !== "/unsta_demo"
)
  throw new Error(
    "Las pruebas automáticas requieren PostgreSQL local unsta_demo",
  );
const owner = new PrismaClient({ datasources: { db: { url: ownerUrl.href } } });
const exists = await owner.$queryRaw<
  { exists: boolean }[]
>`SELECT EXISTS(SELECT FROM pg_database WHERE datname='unsta_demo_test')`;
if (!exists[0].exists)
  await owner.$executeRawUnsafe("CREATE DATABASE unsta_demo_test");
await owner.$disconnect();
ownerUrl.pathname = "/unsta_demo_test";
runtimeUrl.pathname = "/unsta_demo_test";
const env = {
  ...process.env,
  DATABASE_URL: runtimeUrl.href,
  MIGRATION_DATABASE_URL: ownerUrl.href,
  DISPATCH_ENABLED: "false",
  N8N_CONVERSATION_URL: "",
  N8N_OPENING_URL: "",
};
const cwd = fileURLToPath(new URL("../", import.meta.url));
const migration = spawnSync(
  process.execPath,
  ["--import", "tsx", "scripts/migrate.ts"],
  { cwd, env, stdio: "inherit" },
);
if (migration.status !== 0) process.exit(migration.status ?? 1);
const testOwner = new PrismaClient({
  datasources: { db: { url: ownerUrl.href } },
});
// Only this dedicated local test database is reset; never the demo database.
const tables = await testOwner.$queryRaw<
  { tablename: string }[]
>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
await testOwner.$executeRawUnsafe(
  "TRUNCATE " +
    tables.map((t) => '"' + t.tablename.replaceAll('"', '""') + '"').join(",") +
    " CASCADE",
);
await testOwner.$disconnect();
const result = spawnSync(
  process.execPath,
  ["--import", "tsx", "--test", "test/backend.test.ts"],
  { cwd, env, stdio: "inherit" },
);
process.exit(result.status ?? 1);
