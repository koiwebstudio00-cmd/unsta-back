import { randomUUID } from "node:crypto";
import { db, scoped, firstPendingTurn } from "./db.js";
import { config } from "./config.js";
import { runLeadFollowups } from "./lead-followup.js";
// Durable outbox. Network calls occur after committing a lease; no overlapping
// tick per process, and lease compare-and-set protects concurrent workers.
export async function recoverExpired(now = new Date()) {
  const workspaces = await db.workspace.findMany({ select: { id: true } });
  for (const ws of workspaces)
    await scoped(ws.id, async (tx) => {
      const turns = await tx.turn.findMany({
        where: { status: "procesando", leaseUntil: { lt: now } },
      });
      for (const t of turns) {
        const c = await tx.conversation.findUniqueOrThrow({
          where: { id: t.conversationId },
        });
        const retry = t.attempts < 2 && c.mode === "bot";
        await tx.turn.update({
          where: { id: t.id },
          data: {
            status: retry ? "encolado" : "fallido",
            tokenHash: null,
            attemptId: null,
            leaseUntil: null,
            failureCode: "ATTEMPT_TIMEOUT",
          },
        });
        await tx.dispatch.update({
          where: { entityId: t.id },
          data: {
            status: retry ? "pending" : "done",
            availableAt: now,
            attempts: 0,
            leaseUntil: null,
            leaseId: null,
          },
        });
      }
      const events = await tx.openingEvent.findMany({
        where: { status: "procesando", leaseUntil: { lt: now } },
      });
      for (const e of events) {
        const retry = e.attempts < 2;
        await tx.openingEvent.update({
          where: { id: e.id },
          data: {
            status: retry ? "encolado" : "fallido",
            tokenHash: null,
            attemptId: null,
            leaseUntil: null,
          },
        });
        await tx.dispatch.update({
          where: { entityId: e.id },
          data: {
            status: retry ? "pending" : "done",
            availableAt: now,
            attempts: 0,
            leaseUntil: null,
            leaseId: null,
          },
        });
      }
    });
  // Accepted HTTP 202 with no claim (or a lost transport worker) is bounded too.
  const stalled = await db.dispatch.findMany({
    where: { status: { in: ["accepted", "sending"] }, leaseUntil: { lt: now } },
  });
  for (const job of stalled)
    await scoped(job.workspaceId, async (tx) => {
      const latest = await tx.dispatch.findUniqueOrThrow({
        where: { id: job.id },
      });
      if (
        !["accepted", "sending"].includes(latest.status) ||
        !latest.leaseUntil ||
        latest.leaseUntil >= now
      )
        return;
      const exhausted = latest.attempts >= 3;
      await tx.dispatch.update({
        where: { id: job.id },
        data: {
          status: exhausted ? "failed" : "pending",
          leaseId: null,
          leaseUntil: null,
          lastCode: "CLAIM_TIMEOUT",
        },
      });
      if (exhausted) {
        if (job.kind === "turn")
          await tx.turn.updateMany({
            where: { id: job.entityId, status: "encolado" },
            data: { status: "fallido", failureCode: "CLAIM_TIMEOUT" },
          });
        else
          await tx.openingEvent.updateMany({
            where: { id: job.entityId, status: "encolado" },
            data: { status: "fallido" },
          });
      }
    });
}
export async function dispatchOnce(fetcher: typeof fetch = fetch) {
  const candidates = await db.dispatch.findMany({
    where: { status: "pending", availableAt: { lte: new Date() } },
    orderBy: { createdAt: "asc" },
    take: 20,
  });
  for (const job of candidates) {
    const target =
      job.kind === "turn"
        ? config.N8N_CONVERSATION_URL
        : config.N8N_OPENING_URL;
    if (!target) continue;
    const url = new URL(target);
    if (url.protocol !== "https:" || url.username || url.password)
      throw new Error("Webhook n8n exige HTTPS sin credenciales en URL");
    // Do not consume dispatch retries on later turns blocked behind active work.
    const ready = await scoped(job.workspaceId, async (tx) => {
      if (job.kind === "event") {
        const e = await tx.openingEvent.findUnique({
          where: { id: job.entityId },
        });
        return e?.status === "encolado";
      }
      const t = await tx.turn.findUnique({ where: { id: job.entityId } });
      if (!t || t.status !== "encolado") return false;
      const first = await firstPendingTurn(tx, t.conversationId);
      return first?.id === t.id;
    });
    if (!ready) continue;
    const leaseId = randomUUID();
    const acquired = await db.dispatch.updateMany({
      where: { id: job.id, status: "pending" },
      data: {
        status: "sending",
        leaseId,
        leaseUntil: new Date(Date.now() + 30000),
        attempts: { increment: 1 },
      },
    });
    if (!acquired.count) continue;
    let accepted = false,
      code = "NETWORK";
    try {
      const response = await fetcher(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-UNSTA-Webhook-Key": config.N8N_WEBHOOK_KEY,
        },
        body: JSON.stringify({
          [job.kind === "turn" ? "turn_id" : "event_id"]: job.entityId,
        }),
        signal: AbortSignal.timeout(10000),
        redirect: "error",
      });
      accepted = response.status === 202;
      code = `HTTP_${response.status}`;
    } catch {
      /* persist code only; never headers, bodies or secrets */
    }
    await scoped(job.workspaceId, async (tx) => {
      const current = await tx.dispatch.findUniqueOrThrow({
        where: { id: job.id },
      });
      // Claim/complete may already have advanced the job while HTTP was in flight.
      if (current.leaseId !== leaseId || current.status !== "sending") return;
      const exhausted = current.attempts >= 3;
      await tx.dispatch.update({
        where: { id: job.id },
        data: {
          status: accepted ? "accepted" : exhausted ? "failed" : "pending",
          leaseId: null,
          leaseUntil: accepted ? new Date(Date.now() + 30000) : null,
          availableAt: new Date(Date.now() + 5000 * current.attempts),
          lastCode: code,
        },
      });
      if (exhausted && !accepted) {
        if (job.kind === "turn")
          await tx.turn.updateMany({
            where: { id: job.entityId, status: "encolado" },
            data: { status: "fallido", failureCode: code },
          });
        else
          await tx.openingEvent.updateMany({
            where: { id: job.entityId, status: "encolado" },
            data: { status: "fallido" },
          });
      }
    });
  }
}
export function startWorker() {
  let stopped = false,
    timer: ReturnType<typeof setTimeout>;
  async function tick() {
    if (stopped) return;
    try {
      await recoverExpired();
      if (config.DISPATCH_ENABLED === "true") {
        await dispatchOnce();
        await runLeadFollowups();
      }
    } catch {
      console.error(JSON.stringify({ code: "WORKER_FAILURE" }));
    }
    if (!stopped) timer = setTimeout(tick, 1000);
  }
  void tick();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
