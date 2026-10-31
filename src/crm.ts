import { Prisma } from "@prisma/client";
import { scoped, asJson, type Tx } from "./db.js";
import { digest, canonical, fail, publicTurn } from "./common.js";
import { knowledge, isProposal } from "./knowledge.js";
import type { Actor } from "./auth.js";
export async function audit(
  tx: Tx,
  ws: string,
  kind: string,
  id: string,
  actor: string,
  data: unknown = {},
) {
  await tx.audit.create({
    data: { workspaceId: ws, kind, entityId: id, actor, data: asJson(data) },
  });
}
export async function conversation(tx: Tx, id: string) {
  const c = await tx.conversation.findUnique({ where: { id } });
  if (!c) fail(404, "NOT_FOUND", "Conversación no encontrada");
  return c;
}
export async function contact(tx: Tx, id: string) {
  const c = await tx.contact.findUnique({ where: { id } });
  if (!c) fail(404, "NOT_FOUND", "Contacto no encontrado");
  return c;
}
export async function append(
  tx: Tx,
  ws: string,
  id: string,
  role: string,
  text: string,
  extra: Record<string, unknown> = {},
) {
  const c = await tx.conversation.update({
    where: { id },
    data: { sequence: { increment: 1 } },
  });
  return tx.message.create({
    data: {
      workspaceId: ws,
      conversationId: id,
      role,
      text,
      sequence: c.sequence,
      ...extra,
    },
  });
}
export const createConversation = (actor: Actor, contactId?: string) =>
  scoped(actor.workspaceId, async (tx) => {
    const c = contactId
      ? await contact(tx, contactId)
      : await tx.contact.create({ data: { workspaceId: actor.workspaceId } });
    const cv = await tx.conversation.create({
      data: { workspaceId: actor.workspaceId, contactId: c.id },
    });
    await audit(
      tx,
      actor.workspaceId,
      "conversation.created",
      cv.id,
      actor.email,
    );
    return { conversation: cv, contact: c };
  });
export const createLead = (actor: Actor, fields: Record<string, string>) =>
  scoped(actor.workspaceId, async (tx) => {
    const c = await tx.contact.create({
      data: {
        workspaceId: actor.workspaceId,
        fields,
        protectedFields: Object.keys(fields),
      },
    });
    const cv = await tx.conversation.create({
      data: { workspaceId: actor.workspaceId, contactId: c.id },
    });
    await audit(tx, actor.workspaceId, "lead.created", c.id, actor.email);
    return { contact: c, conversation: cv };
  });
export const moveLead = (actor: Actor, id: string, stage: string) =>
  scoped(actor.workspaceId, async (tx) => {
    const c = await contact(tx, id);
    const result = await tx.contact.update({
      where: { id },
      data: { pipelineStage: stage },
    });
    await audit(tx, actor.workspaceId, "contact.pipeline", id, actor.email, {
      from: c.pipelineStage,
      to: stage,
      simulated: stage === "inscripcion_simulada",
    });
    return result;
  });
export const sendMessage = (
  actor: Actor,
  id: string,
  text: string,
  clientMessageId: string,
) =>
  scoped(actor.workspaceId, async (tx) => {
    const c = await conversation(tx, id);
    const previous = await tx.message.findUnique({
      where: {
        conversationId_clientMessageId: { conversationId: id, clientMessageId },
      },
    });
    if (previous) {
      if (previous.text !== text)
        fail(409, "IDEMPOTENCY", "El identificador ya tiene otro mensaje");
      return {
        message: previous,
        turn: await tx.turn
          .findUnique({ where: { messageId: previous.id } })
          .then((t) => (t ? publicTurn(t) : null)),
      };
    }
    if (c.mode === "cerrada")
      fail(409, "CLOSED", "La conversación está cerrada");
    if (
      (await tx.turn.count({
        where: {
          conversationId: id,
          status: { in: ["encolado", "procesando"] },
        },
      })) >= 20
    )
      fail(429, "QUEUE_FULL", "Esperá que se procesen los mensajes pendientes");
    const message = await append(tx, actor.workspaceId, id, "user", text, {
      clientMessageId,
    });
    let turn = null;
    if (c.mode === "bot") {
      turn = await tx.turn.create({
        data: {
          workspaceId: actor.workspaceId,
          conversationId: id,
          messageId: message.id,
          controlVersion: c.controlVersion,
          knowledgeVersion: knowledge.kb.version,
          knowledgeHash: knowledge.hash,
        },
      });
      await tx.dispatch.create({
        data: {
          workspaceId: actor.workspaceId,
          entityId: turn.id,
          kind: "turn",
        },
      });
    } else
      await audit(tx, actor.workspaceId, "human.incoming", id, actor.email, {
        message_id: message.id,
      });
    return { message, turn: turn ? publicTurn(turn) : null };
  });
export const getConversation = (actor: Actor, id: string) =>
  scoped(actor.workspaceId, async (tx) => {
    const c = await conversation(tx, id);
    return {
      conversation: c,
      contact: await contact(tx, c.contactId),
      messages: await tx.message.findMany({
        where: { conversationId: id },
        orderBy: { sequence: "asc" },
        take: 500,
      }),
      turns: (
        await tx.turn.findMany({
          where: { conversationId: id },
          orderBy: { createdAt: "desc" },
          take: 20,
        })
      ).map(publicTurn),
      cases: await tx.attentionCase.findMany({ where: { conversationId: id } }),
    };
  });
export const listContacts = (actor: Actor) =>
  scoped(actor.workspaceId, async (tx) => ({
    contacts: await tx.contact.findMany({
      orderBy: { updatedAt: "desc" },
      take: 200,
    }),
    interests: await tx.interest.findMany({ take: 1000 }),
    conversations: await tx.conversation.findMany({
      orderBy: { updatedAt: "desc" },
      take: 200,
    }),
  }));
export const getContact = (actor: Actor, id: string) =>
  scoped(actor.workspaceId, async (tx) => ({
    contact: await contact(tx, id),
    interests: await tx.interest.findMany({ where: { contactId: id } }),
    notes: await tx.note.findMany({
      where: { contactId: id },
      orderBy: { createdAt: "asc" },
    }),
    tasks: await tx.task.findMany({ where: { contactId: id } }),
    subscriptions: await tx.subscription.findMany({ where: { contactId: id } }),
    notices: await tx.notice.findMany({ where: { contactId: id } }),
  }));
export const control = (
  actor: Actor,
  id: string,
  action: "take" | "release" | "close",
) =>
  scoped(actor.workspaceId, async (tx) => {
    const c = await conversation(tx, id);
    const mode = { take: "humano", release: "bot", close: "cerrada" }[action];
    if (c.mode === mode) return c;
    const cv = await tx.conversation.update({
      where: { id },
      data: { mode, controlVersion: { increment: 1 } },
    });
    const running = await tx.turn.findMany({
      where: { conversationId: id, status: { in: ["encolado", "procesando"] } },
    });
    await tx.turn.updateMany({
      where: { conversationId: id, status: { in: ["encolado", "procesando"] } },
      data: { status: "cancelado", failureCode: "human_control" },
    });
    await tx.dispatch.updateMany({
      where: { entityId: { in: running.map((t) => t.id) } },
      data: { status: "done", leaseUntil: null, leaseId: null },
    });
    await tx.attentionCase.updateMany({
      where: { conversationId: id, status: { in: ["pendiente", "tomado"] } },
      data: { status: action === "take" ? "tomado" : "resuelto" },
    });
    await audit(
      tx,
      actor.workspaceId,
      "conversation." + action,
      id,
      actor.email,
    );
    return cv;
  });
export const humanReply = (
  actor: Actor,
  id: string,
  text: string,
  clientMessageId: string,
) =>
  scoped(actor.workspaceId, async (tx) => {
    const c = await conversation(tx, id);
    if (c.mode !== "humano")
      fail(409, "TAKE_FIRST", "Tomá la conversación antes de responder");
    const previous = await tx.message.findUnique({
      where: {
        conversationId_clientMessageId: { conversationId: id, clientMessageId },
      },
    });
    if (previous) {
      if (previous.text !== text || previous.role !== "operator")
        fail(409, "IDEMPOTENCY", "Conflicto de mensaje");
      return previous;
    }
    return append(tx, actor.workspaceId, id, "operator", text, {
      clientMessageId,
    });
  });
export const editContact = (
  actor: Actor,
  id: string,
  fields: Record<string, string>,
) =>
  scoped(actor.workspaceId, async (tx) => {
    const c = await contact(tx, id);
    const updated = await tx.contact.update({
      where: { id },
      data: {
        fields: { ...(c.fields as object), ...fields },
        protectedFields: [
          ...new Set([...c.protectedFields, ...Object.keys(fields)]),
        ],
      },
    });
    await audit(tx, actor.workspaceId, "contact.corrected", id, actor.email, {
      fields: Object.keys(fields),
    });
    return updated;
  });
export const changeStage = (actor: Actor, id: string, stage: string) =>
  scoped(actor.workspaceId, async (tx) => {
    const interest = await tx.interest.findUnique({ where: { id } });
    if (!interest) fail(404, "NOT_FOUND", "Interés no encontrado");
    const result = await tx.interest.update({
      where: { id },
      data: { stage, protectedFields: true },
    });
    await audit(tx, actor.workspaceId, "interest.stage", id, actor.email, {
      stage,
      simulated: stage === "inscripcion_simulada",
    });
    return result;
  });
export const addNote = (actor: Actor, id: string, text: string) =>
  scoped(actor.workspaceId, async (tx) => {
    await contact(tx, id);
    return tx.note.create({
      data: {
        workspaceId: actor.workspaceId,
        contactId: id,
        text,
        author: actor.email,
      },
    });
  });
export const addTask = (actor: Actor, id: string, text: string, dueAt: Date) =>
  scoped(actor.workspaceId, async (tx) => {
    await contact(tx, id);
    return tx.task.create({
      data: { workspaceId: actor.workspaceId, contactId: id, text, dueAt },
    });
  });
export const finishTask = (actor: Actor, id: string, status: string) =>
  scoped(actor.workspaceId, async (tx) => {
    if (!(await tx.task.findUnique({ where: { id } })))
      fail(404, "NOT_FOUND", "Tarea no encontrada");
    return tx.task.update({ where: { id }, data: { status } });
  });
export const cancelSubscription = (actor: Actor, id: string) =>
  scoped(actor.workspaceId, async (tx) => {
    if (!(await tx.subscription.findUnique({ where: { id } })))
      fail(404, "NOT_FOUND", "Suscripción no encontrada");
    const r = await tx.subscription.update({
      where: { id },
      data: { status: "cancelada" },
    });
    await audit(
      tx,
      actor.workspaceId,
      "subscription.cancelled",
      id,
      actor.email,
    );
    return r;
  });
export const createOpening = (
  actor: Actor,
  proposalId: string,
  description: string,
) =>
  scoped(actor.workspaceId, async (tx) => {
    if (!isProposal(proposalId) || proposalId.startsWith("carrera-"))
      fail(400, "PROPOSAL", "Seleccioná un curso de la demo");
    const event = await tx.openingEvent.create({
      data: { workspaceId: actor.workspaceId, proposalId, description },
    });
    await tx.dispatch.create({
      data: {
        workspaceId: actor.workspaceId,
        entityId: event.id,
        kind: "event",
      },
    });
    return event;
  });
export const followup = (actor: Actor) =>
  scoped(actor.workspaceId, async (tx) => ({
    tasks: await tx.task.findMany({ orderBy: { dueAt: "asc" }, take: 200 }),
    subscriptions: await tx.subscription.findMany({ take: 500 }),
    events: await tx.openingEvent.findMany({
      select: {
        id: true,
        proposalId: true,
        description: true,
        status: true,
        simulated: true,
        result: true,
      },
      take: 100,
    }),
    notices: await tx.notice.findMany({ take: 500 }),
    cases: await tx.attentionCase.findMany({ take: 200 }),
  }));
export const retryTurn = (actor: Actor, id: string) =>
  scoped(actor.workspaceId, async (tx) => {
    const t = await tx.turn.findUnique({ where: { id } });
    if (!t) fail(404, "NOT_FOUND", "Turno no encontrado");
    const c = await conversation(tx, t.conversationId);
    if (t.status !== "fallido" || c.mode !== "bot")
      fail(
        409,
        "RETRY",
        "Solo se puede reintentar un turno fallido en modo bot",
      );
    const updated = await tx.turn.update({
      where: { id },
      data: {
        status: "encolado",
        attempts: 0,
        attemptId: null,
        tokenHash: null,
        leaseUntil: null,
        summaryUntil: null,
        failureCode: null,
        controlVersion: c.controlVersion,
      },
    });
    await tx.dispatch.update({
      where: { entityId: id },
      data: {
        status: "pending",
        attempts: 0,
        availableAt: new Date(),
        leaseUntil: null,
        leaseId: null,
      },
    });
    await audit(tx, actor.workspaceId, "turn.retry", id, actor.email);
    return publicTurn(updated);
  });
