import { PrismaClient, Prisma } from "@prisma/client";
import "./config.js";
export const db = new PrismaClient();
export type Tx = Prisma.TransactionClient;
// A short workspace-level transaction lock is sufficient for this small demo.
// No model or network requests run inside it. Serializes control changes and writes.
export const scoped = <T>(workspaceId: string, fn: (tx: Tx) => Promise<T>) =>
  db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.workspace_id',${workspaceId},true)`;
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${workspaceId},0))::text`;
      return fn(tx);
    },
    { maxWait: 10000, timeout: 15000 },
  );
export const asJson = (x: unknown) =>
  JSON.parse(JSON.stringify(x)) as Prisma.InputJsonValue;
export async function checkRuntimeRole() {
  const roles = await db.$queryRaw<
    { rolsuper: boolean; rolbypassrls: boolean }[]
  >`SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user`;
  if (roles[0]?.rolsuper || roles[0]?.rolbypassrls)
    throw new Error(
      "La API exige usuario PostgreSQL sin SUPERUSER ni BYPASSRLS",
    );
}
// Message sequence, not wall-clock timestamps, defines turn order even when
// multiple messages are inserted within the same millisecond.
export async function firstPendingTurn(tx: Tx, conversationId: string) {
  const turns = await tx.turn.findMany({
    where: { conversationId, status: { in: ["encolado", "procesando"] } },
  });
  if (!turns.length) return null;
  const first = await tx.message.findFirst({
    where: { id: { in: turns.map((t) => t.messageId) } },
    orderBy: { sequence: "asc" },
  });
  return turns.find((t) => t.messageId === first?.id) ?? null;
}
