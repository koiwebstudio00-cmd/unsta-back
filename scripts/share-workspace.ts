// Run while the API is stopped. Reassign access from an EMPTY legacy workspace;
// never silently orphan or merge operational data from a populated workspace.
import { z } from "zod";
import { db, scoped } from "../src/db.js";
import { config } from "../src/config.js";
const source = z.string().uuid().parse(process.argv[2]);
const target = config.UNSTA_WORKSPACE_ID;
if (source === target) throw new Error("Origen y destino deben ser distintos");
try {
  await db.workspace.findUniqueOrThrow({ where: { id: target } });
  const result = await scoped(source, async (tx) => {
    await tx.workspace.findUniqueOrThrow({ where: { id: source } });
    const tables = [
      "Contact",
      "Conversation",
      "Message",
      "Turn",
      "Interest",
      "AttentionCase",
      "ToolCall",
      "Note",
      "Task",
      "Subscription",
      "OpeningEvent",
      "Notice",
      "Audit",
      "Dispatch",
    ];
    for (const table of tables) {
      const rows = await tx.$queryRawUnsafe<{ count: bigint }[]>(
        `SELECT count(*) FROM "${table}" WHERE "workspaceId" = $1::uuid`,
        source,
      );
      if (Number(rows[0].count))
        throw new Error(
          `El espacio origen contiene ${table}; se requiere migración de datos explícita`,
        );
    }
    const invitations = await tx.invite.updateMany({
      where: { workspaceId: source },
      data: { workspaceId: target },
    });
    const sessions = await tx.session.updateMany({
      where: { workspaceId: source },
      data: { workspaceId: target },
    });
    await tx.workspace.update({
      where: { id: target },
      data: { name: "UNSTA" },
    });
    return {
      source,
      target,
      sessions: sessions.count,
      invitations: invitations.count,
    };
  });
  console.log(JSON.stringify(result));
} finally {
  await db.$disconnect();
}
