import { randomUUID } from "node:crypto";
import { scoped, asJson } from "./db.js";
import { scopeFor } from "./agent.js";
import { token, digest, fail } from "./common.js";
import { knowledge } from "./knowledge.js";
export const claimEvent = async (
  id: string,
  metadata: { execution_id: string; workflow_id: string },
) =>
  scoped(await scopeFor(id, "event"), async (tx) => {
    const e = await tx.openingEvent.findUniqueOrThrow({ where: { id } });
    if (e.status !== "encolado" || e.attempts >= 2)
      return { claimed: false, event_id: id };
    const secret = token(),
      attemptId = randomUUID();
    await tx.openingEvent.update({
      where: { id },
      data: {
        status: "procesando",
        attemptId,
        tokenHash: digest(secret),
        leaseUntil: new Date(Date.now() + 90000),
        attempts: { increment: 1 },
        executionId: metadata.execution_id,
        workflowId: metadata.workflow_id,
      },
    });
    await tx.dispatch.update({
      where: { entityId: id },
      data: { status: "accepted", leaseId: null, leaseUntil: null },
    });
    return {
      claimed: true,
      event_id: id,
      attempt_id: attemptId,
      attempt_token: secret,
    };
  });
export const processEvent = async (
  id: string,
  secret: string,
  attemptId: string,
) =>
  scoped(await scopeFor(id, "event"), async (tx) => {
    const e = await tx.openingEvent.findUniqueOrThrow({ where: { id } });
    if (!secret || e.tokenHash !== digest(secret) || e.attemptId !== attemptId)
      fail(403, "ATTEMPT", "Intento inválido");
    if (e.status === "completado") return e.result;
    if (e.status !== "procesando" || !e.leaseUntil || e.leaseUntil < new Date())
      fail(409, "EXPIRED", "Intento vencido");
    const subs = await tx.subscription.findMany({
      where: { proposalId: e.proposalId },
    });
    if (subs.length > 500)
      fail(
        409,
        "BATCH_LIMIT",
        "El evento supera el límite de 500 suscripciones de la demo",
      );
    let generated = 0,
      omitted = 0;
    for (const sub of subs) {
      if (sub.status !== "activa") {
        omitted++;
        continue;
      }
      // Same workspace transaction lock as cancellation: consent check and insert atomic.
      const notice = await tx.notice.createMany({
        data: [
          {
            workspaceId: e.workspaceId,
            contactId: sub.contactId,
            eventId: e.id,
            subscriptionId: sub.id,
            text: `Aviso simulado de la demo: apertura de ${knowledge.records.get(e.proposalId)?.titulo}. ${e.description} No es una convocatoria institucional.`,
          },
        ],
        skipDuplicates: true,
      });
      generated += notice.count;
    }
    const result = {
      ok: true,
      data: {
        estado: "completado",
        generados: generated,
        omitidos: omitted,
        simulado: true,
      },
    };
    await tx.openingEvent.update({
      where: { id },
      data: { status: "completado", result: asJson(result) },
    });
    await tx.dispatch.update({
      where: { entityId: id },
      data: { status: "done", leaseId: null, leaseUntil: null },
    });
    return result;
  });
