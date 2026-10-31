import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import AjvModule from "ajv";
import formatsModule from "ajv-formats";
import { Prisma, type Turn } from "@prisma/client";
import { db, scoped, asJson, firstPendingTurn, type Tx } from "./db.js";
import { digest, token, canonical, fail, normalize } from "./common.js";
import {
  knowledge,
  proposals,
  isProposal,
  getRecords,
  searchKnowledge,
} from "./knowledge.js";
import { append, audit } from "./crm.js";
import {
  catalogMatches,
  declaredContact,
  declaredInterests,
} from "./capture.js";
import { normalizeSummary } from "../agent-contract/runtime.mjs";
const Ajv = (AjvModule as any).default ?? AjvModule,
  formats = (formatsModule as any).default ?? formatsModule;
const ajv = new Ajv({ allErrors: false, strict: false });
formats(ajv);
const contracts = JSON.parse(
  readFileSync(
    new URL("../agent-contract/tools.json", import.meta.url),
    "utf8",
  ),
).tools;
const validators = new Map<string, any>(
  contracts.map((t: any) => [t.name, ajv.compile(t.inputSchema)]),
);
const ack =
  "Tu consulta quedó derivada al equipo de esta demo. Está pendiente de atención en el panel; no se envió a la universidad.";
const error = (code: string, message: string) => ({
  ok: false,
  error: { code, message },
});
async function saveContact(tx: Tx, contactId: string, d: any) {
  const profile = await tx.contact.findUniqueOrThrow({
    where: { id: contactId },
  });
  const { mensaje_evidencia_id, ...fields } = d;
  if (Object.keys(fields).some((k) => profile.protectedFields.includes(k)))
    return error("MANUAL_OVERRIDE", "Un operador corrigió ese campo");
  const updated = await tx.contact.update({
    where: { id: profile.id },
    data: { fields: asJson({ ...(profile.fields as object), ...fields }) },
  });
  return {
    ok: true,
    data: {
      contacto: { id: updated.id, ...(updated.fields as object) },
      campos_actualizados: Object.keys(fields),
    },
  };
}
async function saveInterest(
  tx: Tx,
  workspaceId: string,
  contactId: string,
  d: any,
) {
  if (d.propuesta_libre) {
    const matches = catalogMatches(d.propuesta_libre);
    if (matches.length > 1)
      return error(
        "PROPOSAL_AMBIGUOUS",
        "Hay varias propuestas del catálogo: pedí que elija una antes de guardar el interés",
      );
    if (matches.length === 1) {
      const { propuesta_libre, ...rest } = d;
      d = { ...rest, propuesta_id: matches[0].id };
    }
  }
  if (d.propuesta_id && !isProposal(d.propuesta_id))
    return error("PROPOSAL", "Propuesta fuera del catálogo");
  const identity = digest(
    canonical([
      d.propuesta_id ?? normalize(d.propuesta_libre),
      d.sede ?? "",
      d.periodo ?? "",
    ]),
  );
  let existing = await tx.interest.findUnique({
    where: { contactId_identity: { contactId: contactId, identity } },
  });
  if (!existing && d.propuesta_id) {
    const legacy = (
      await tx.interest.findMany({ where: { contactId: contactId } })
    ).filter((i) => {
      const v = i.data as any;
      const matches = v.propuesta_libre
        ? catalogMatches(v.propuesta_libre)
        : [];
      return (
        matches.length === 1 &&
        matches[0].id === d.propuesta_id &&
        (v.sede ?? "") === (d.sede ?? "") &&
        (v.periodo ?? "") === (d.periodo ?? "")
      );
    });
    if (legacy.length === 1) {
      if (legacy[0].protectedFields)
        return error("MANUAL_OVERRIDE", "El operador corrigió este interés");
      const { propuesta_libre, ...previousData } = legacy[0].data as any;
      existing = await tx.interest.update({
        where: { id: legacy[0].id },
        data: {
          identity,
          data: asJson({ ...previousData, propuesta_id: d.propuesta_id }),
        },
      });
    }
  }
  if (existing?.protectedFields)
    return error("MANUAL_OVERRIDE", "El operador corrigió este interés");
  const { mensaje_evidencia_id, preinscripcion_declarada, ...data } = d;
  const interest = await tx.interest.upsert({
    where: { contactId_identity: { contactId: contactId, identity } },
    create: {
      workspaceId: workspaceId,
      contactId: contactId,
      identity,
      data,
      evidenceId: mensaje_evidencia_id,
      stage: preinscripcion_declarada ? "preinscripcion_declarada" : "nuevo",
    },
    update: {
      data: asJson({ ...(existing?.data as object), ...data }),
      evidenceId: mensaje_evidencia_id,
      ...(preinscripcion_declarada
        ? { stage: "preinscripcion_declarada" }
        : {}),
    },
  });
  return { ok: true, data: { interes: interest, created: !existing } };
}
export async function scopeFor(entityId: string, kind: "turn" | "event") {
  const job = await db.dispatch.findUnique({ where: { entityId } });
  if (!job || job.kind !== kind)
    fail(404, "NOT_FOUND", "Trabajo no encontrado");
  return job.workspaceId;
}
async function getTurn(tx: Tx, id: string) {
  const t = await tx.turn.findUnique({ where: { id } });
  if (!t) fail(404, "NOT_FOUND", "Turno no encontrado");
  return t;
}
function authAttempt(
  t: { attemptId: string | null; tokenHash: string | null },
  secret: string,
  attemptId?: string,
) {
  if (
    !secret ||
    !t.tokenHash ||
    digest(secret) !== t.tokenHash ||
    (attemptId !== undefined && t.attemptId !== attemptId)
  )
    fail(403, "ATTEMPT", "Intento no autorizado");
}
function active(t: Turn) {
  if (t.status !== "procesando" || !t.leaseUntil || t.leaseUntil < new Date())
    fail(409, "STALE_ATTEMPT", "El intento ya no puede modificar datos");
}
export const claimTurn = async (
  id: string,
  metadata: {
    execution_id: string;
    workflow_id: string;
    contract_version: string;
  },
) => {
  const ws = await scopeFor(id, "turn");
  return scoped(ws, async (tx) => {
    const t = await getTurn(tx, id),
      c = await tx.conversation.findUniqueOrThrow({
        where: { id: t.conversationId },
      });
    const no = { claimed: false, turn_id: id };
    if (t.status !== "encolado" || c.mode !== "bot" || t.attempts >= 2)
      return no;
    const first = await firstPendingTurn(tx, c.id);
    if (first?.id !== id) return no;
    const attemptId = randomUUID(),
      secret = token(),
      now = Date.now();
    const current = await tx.message.findUniqueOrThrow({
      where: { id: t.messageId },
    });
    // Include responses to preceding turns even when they were persisted after
    // this user message. Exclude user messages queued for later turns.
    const messages = await tx.message.findMany({
      where: {
        conversationId: c.id,
        OR: [
          { sequence: { lte: current.sequence } },
          { role: { in: ["assistant", "operator"] } },
        ],
      },
      orderBy: { sequence: "desc" },
      take: 20,
    });
    const declared = declaredContact(current.text);
    const originalProfile = await tx.contact.findUniqueOrThrow({
      where: { id: c.contactId },
    });
    const fields = Object.fromEntries(
      Object.entries(declared).filter(
        ([key]) => !originalProfile.protectedFields.includes(key),
      ),
    );
    if (Object.keys(fields).length) {
      const args = { ...fields, mensaje_evidencia_id: current.id };
      if (validators.get("actualizar_contacto")(args)) {
        const result = await saveContact(tx, c.contactId, args);
        await tx.toolCall.upsert({
          where: {
            turnId_name_argumentHash: {
              turnId: id,
              name: "actualizar_contacto",
              argumentHash: digest(canonical(args)),
            },
          },
          create: {
            workspaceId: t.workspaceId,
            turnId: id,
            name: "actualizar_contacto",
            argumentHash: digest(canonical(args)),
            result: asJson(result),
          },
          update: { result: asJson(result) },
        });
        await audit(
          tx,
          t.workspaceId,
          "capture.contact",
          c.contactId,
          "agent",
          { turn_id: id, evidence_id: current.id, fields: Object.keys(fields) },
        );
      }
    }
    for (const declaredInterest of declaredInterests(current.text)) {
      const args = { ...declaredInterest, mensaje_evidencia_id: current.id };
      if (!validators.get("registrar_interes")(args)) continue;
      const result = await saveInterest(tx, t.workspaceId, c.contactId, args);
      if (!result.ok) continue;
      await tx.toolCall.upsert({
        where: {
          turnId_name_argumentHash: {
            turnId: id,
            name: "registrar_interes",
            argumentHash: digest(canonical(args)),
          },
        },
        create: {
          workspaceId: t.workspaceId,
          turnId: id,
          name: "registrar_interes",
          argumentHash: digest(canonical(args)),
          result: asJson(result),
        },
        update: { result: asJson(result) },
      });
      await audit(tx, t.workspaceId, "capture.interest", c.contactId, "agent", {
        turn_id: id,
        evidence_id: current.id,
      });
    }
    const profile = await tx.contact.findUniqueOrThrow({
      where: { id: c.contactId },
    });
    const interests = await tx.interest.findMany({
      where: { contactId: c.contactId },
    });
    const view = (m: any) => ({
      id: m.id,
      role: m.role,
      text: m.text,
      sequence: m.sequence,
    });
    const context = {
      turn_id: id,
      attempt_id: attemptId,
      conversation: {
        id: c.id,
        mode: c.mode,
        control_version: c.controlVersion,
      },
      knowledge_version: t.knowledgeVersion,
      knowledge_hash: t.knowledgeHash,
      context_sequence: c.sequence,
      summary_through_sequence: current.sequence,
      current_message: view(current),
      messages: messages.reverse().map(view),
      contact: profile.fields,
      interests: interests.map((i) => ({
        ...(i.data as object),
        etapa: i.stage,
      })),
      catalog: proposals,
      summary: c.summary,
      summary_due: current.sequence > c.summaryThrough,
    };
    await tx.turn.update({
      where: { id },
      data: {
        status: "procesando",
        attemptId,
        tokenHash: digest(secret),
        leaseUntil: new Date(now + 90000),
        summaryUntil: new Date(now + 120000),
        attempts: { increment: 1 },
        controlVersion: c.controlVersion,
        context: asJson(context),
        recordIds: [],
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
      turn_id: id,
      attempt_id: attemptId,
      attempt_token: secret,
    };
  });
};
export const getContext = async (id: string, secret: string) =>
  scoped(await scopeFor(id, "turn"), async (tx) => {
    const t = await getTurn(tx, id);
    authAttempt(t, secret);
    active(t);
    const c = await tx.conversation.findUniqueOrThrow({
      where: { id: t.conversationId },
    });
    return {
      ...(t.context as object),
      conversation: {
        id: c.id,
        mode: c.mode,
        control_version: c.controlVersion,
      },
    };
  });
function proposalMention(id: string, text: string) {
  const proposal = knowledge.records.get(id);
  if (!proposal) return false;
  const title = normalize(proposal.titulo);
  const n = normalize(text);
  const terms = title
    .split(/[^a-z0-9]+/)
    .filter(
      (x) =>
        x.length > 3 &&
        ![
          "licenciatura",
          "ingenieria",
          "diplomatura",
          "cohorte",
          "sexta",
          "publico",
          "automatizacion",
        ].includes(x),
    );
  return (
    terms.some((x) => new RegExp("\\b" + x + "\\b").test(n)) ||
    (id === "carrera-psicologia" && /\bpsico\b/.test(n))
  );
}
async function validateEvidence(tx: Tx, t: Turn, name: string, d: any) {
  if (!d.mensaje_evidencia_id) return null;
  const m = await tx.message.findUnique({
      where: { id: d.mensaje_evidencia_id },
    }),
    ctx = t.context as any;
  if (
    !m ||
    m.role !== "user" ||
    m.conversationId !== t.conversationId ||
    m.sequence > ctx.current_message.sequence
  )
    return error(
      "EVIDENCE",
      "Falta un mensaje propio del interesado que respalde el dato",
    );
  const n = normalize(m.text);
  if (name === "actualizar_contacto") {
    for (const field of ["nombre", "email", "telefono"])
      if (
        d[field] &&
        (!n.includes(normalize(d[field])) ||
          /\bno (me llamo|soy|es mi)\b/.test(n))
      )
        return error("EVIDENCE", "El valor no está respaldado por el mensaje");
    if (d.condicion) {
      const pattern = {
        alumno: /\bsoy (alumno|alumna|estudiante)\b/,
        ingresante: /\b(soy ingresante|quiero ingresar)\b/,
        otro: /\bsoy (padre|madre|tutor|docente|graduado|graduada)\b/,
      }[d.condicion as "alumno"];
      if (!pattern?.test(n) || /\bno soy\b/.test(n))
        return error(
          "EVIDENCE",
          "La condición debe ser declarada explícitamente",
        );
    }
  }
  if (name === "registrar_interes") {
    if (
      !/\b(quiero|me interesa|informacion|estudiar|inscribirme|anotarme|preinscripcion)\b/.test(
        n,
      ) ||
      /\b(no quiero|no me interesa)\b/.test(n)
    )
      return error("EVIDENCE", "No hay interés explícito en este mensaje");
    if (d.propuesta_id && !proposalMention(d.propuesta_id, n))
      return error("EVIDENCE", "La propuesta no aparece en la evidencia");
    if (d.propuesta_libre && !n.includes(normalize(d.propuesta_libre)))
      return error("EVIDENCE", "La propuesta libre no aparece en la evidencia");
    for (const field of ["sede", "modalidad", "periodo"])
      if (d[field] && !n.includes(normalize(d[field]).replaceAll("_", " ")))
        return error("EVIDENCE", "No inferir sede, modalidad o período");
    if (
      d.preinscripcion_declarada &&
      !/\b(ya (hice|complete|inicie)|me preinscribi)\b/.test(n)
    )
      return error("EVIDENCE", "Preinscripción no declarada");
  }
  if (name === "gestionar_aviso") {
    if (d.accion === "cancelar") {
      if (
        !/\b(cancelar|cancela|no me avises|deja de avisarme)\b/.test(n) ||
        !proposalMention(d.propuesta_id, n)
      )
        return error(
          "CONSENT",
          "Necesito una cancelación explícita para esa propuesta",
        );
    } else {
      const explicit =
        /\b(avisame|quiero (un|el) aviso|quiero que me avis(?:es|en)|notificame|autorizo (?:que registres |el |un )?aviso|autorizo que registres un aviso|confirmo (?:el |un )aviso)\b/.test(
          n,
        ) &&
        proposalMention(d.propuesta_id, n) &&
        /\b(demo|simulado|panel)\b/.test(n) &&
        !/\b(no|cancelar|cancela|sin autorizar)\b/.test(n);
      const prior = await tx.message.findFirst({
        where: {
          conversationId: m.conversationId,
          sequence: { lt: m.sequence },
        },
        orderBy: { sequence: "desc" },
      });
      const yes =
        /^(si(?:,? confirmo)?|confirmo|dale|acepto|de acuerdo)[.! ]*$/.test(
          n.trim(),
        ) &&
        prior?.role === "assistant" &&
        /\b(queres|aceptas|autorizas|confirmas)\b/.test(
          normalize(prior.text),
        ) &&
        /\b(aviso|avisemos|avise|avisarte)\b/.test(normalize(prior.text)) &&
        /\b(demo|simulado|panel)\b/.test(normalize(prior.text)) &&
        proposalMention(d.propuesta_id, prior.text) &&
        proposals.filter(
          (p: { id: string; seccion: string }) =>
            p.seccion === "cursos" && proposalMention(p.id, prior.text),
        ).length === 1;
      if (!explicit && !yes)
        return error(
          "CONSENT",
          "Pedí permiso explícito para un aviso simulado de esa propuesta en el panel",
        );
    }
  }
  return null;
}
export const executeTool = async (
  id: string,
  secret: string,
  attemptId: string,
  name: string,
  d: any,
) =>
  scoped(await scopeFor(id, "turn"), async (tx) => {
    const t = await getTurn(tx, id);
    authAttempt(t, secret, attemptId);
    active(t);
    const validate = validators.get(name);
    if (!validate || !validate(d))
      return error("VALIDATION", "Parámetros de herramienta inválidos");
    const c = await tx.conversation.findUniqueOrThrow({
      where: { id: t.conversationId },
    });
    const argumentHash = digest(canonical(d));
    const previous = await tx.toolCall.findUnique({
      where: { turnId_name_argumentHash: { turnId: id, name, argumentHash } },
    });
    if (
      c.mode !== "bot" &&
      !(
        name === "derivar_a_area" &&
        previous &&
        c.mode === "esperando_humano" &&
        t.handoffId
      )
    )
      fail(409, "HUMAN_CONTROL", "La conversación está bajo atención humana");
    if (
      c.controlVersion !==
      (t.handoffId ? t.controlVersion + 1 : t.controlVersion)
    )
      fail(409, "CONTROL", "Cambió el control de la conversación");
    if (previous) {
      if (name === "actualizar_contacto") {
        const profile = await tx.contact.findUniqueOrThrow({
          where: { id: c.contactId },
        });
        if (Object.keys(d).some((k) => profile.protectedFields.includes(k)))
          return error("MANUAL_OVERRIDE", "Un operador corrigió ese campo");
      }
      if (name === "gestionar_aviso") {
        const sub = await tx.subscription.findUnique({
          where: {
            contactId_proposalId: {
              contactId: c.contactId,
              proposalId: d.propuesta_id,
            },
          },
        });
        if (sub?.status !== (d.accion === "crear" ? "activa" : "cancelada"))
          return error(
            "STATE_CHANGED",
            "La suscripción cambió desde la operación anterior",
          );
      }
      if (name === "registrar_interes") {
        const cached = previous.result as any;
        const current = await tx.interest.findUnique({
          where: { id: cached.data.interes.id },
        });
        if (current?.protectedFields)
          return error("MANUAL_OVERRIDE", "El operador corrigió este interés");
      }
      // Retrieval replay in a new attempt must repopulate this attempt's permitted refs.
      const data = previous.result as any;
      if (data?.data?.registros)
        await tx.turn.update({
          where: { id },
          data: {
            recordIds: [
              ...new Set([
                ...t.recordIds,
                ...data.data.registros.map((r: any) => r.id),
              ]),
            ],
          },
        });
      return previous.result;
    }
    const invalid = await validateEvidence(tx, t, name, d);
    if (invalid) return invalid;
    let result: any;
    if (name === "consultar_conocimiento" || name === "ver_propuesta") {
      if (
        t.knowledgeHash !== knowledge.hash ||
        t.knowledgeVersion !== knowledge.kb.version
      )
        fail(409, "KNOWLEDGE", "Versión no disponible");
      result =
        name === "ver_propuesta"
          ? isProposal(d.propuesta_id)
            ? getRecords(knowledge, [d.propuesta_id])
            : searchKnowledge(knowledge, {
                consulta: d.propuesta_id
                  .replaceAll("_", " ")
                  .replaceAll("-", " "),
              })
          : searchKnowledge(knowledge, d);
      await tx.turn.update({
        where: { id },
        data: {
          recordIds: [
            ...new Set([
              ...t.recordIds,
              ...result.data.registros.map((r: any) => r.id),
            ]),
          ],
        },
      });
    } else if (name === "actualizar_contacto") {
      result = await saveContact(tx, c.contactId, d);
    } else if (name === "registrar_interes") {
      result = await saveInterest(tx, t.workspaceId, c.contactId, d);
    } else if (name === "gestionar_aviso") {
      if (!isProposal(d.propuesta_id) || d.propuesta_id.startsWith("carrera-"))
        return error("PROPOSAL", "Seleccioná un curso de la demo");
      const sub = await tx.subscription.upsert({
        where: {
          contactId_proposalId: {
            contactId: c.contactId,
            proposalId: d.propuesta_id,
          },
        },
        create: {
          workspaceId: t.workspaceId,
          contactId: c.contactId,
          proposalId: d.propuesta_id,
          evidenceId: d.mensaje_evidencia_id,
          status: d.accion === "crear" ? "activa" : "cancelada",
        },
        update: {
          status: d.accion === "crear" ? "activa" : "cancelada",
          evidenceId: d.mensaje_evidencia_id,
        },
      });
      result = {
        ok: true,
        data: {
          suscripcion: {
            id: sub.id,
            propuesta_id: sub.proposalId,
            estado: sub.status,
            evidencia: sub.evidenceId,
            simulado: true,
          },
        },
      };
    } else if (name === "derivar_a_area") {
      const cs = await tx.attentionCase.create({
        data: {
          workspaceId: t.workspaceId,
          conversationId: c.id,
          turnId: id,
          attemptId,
          area: d.area,
          reason: d.motivo,
          summary: d.resumen,
        },
      });
      await tx.conversation.update({
        where: { id: c.id },
        data: { mode: "esperando_humano", controlVersion: { increment: 1 } },
      });
      await tx.turn.update({ where: { id }, data: { handoffId: cs.id } });
      // No later automatic turns while awaiting a person.
      const queued = await tx.turn.findMany({
        where: { conversationId: c.id, status: "encolado" },
      });
      await tx.turn.updateMany({
        where: { id: { in: queued.map((q) => q.id) } },
        data: { status: "cancelado", failureCode: "handoff" },
      });
      await tx.dispatch.updateMany({
        where: { entityId: { in: queued.map((q) => q.id) } },
        data: { status: "done" },
      });
      result = {
        ok: true,
        data: {
          turn_id: id,
          attempt_id: attemptId,
          caso: { id: cs.id, estado: "pendiente", area: cs.area },
          conversation: {
            id: c.id,
            mode: "esperando_humano",
            control_version: c.controlVersion + 1,
          },
        },
      };
    }
    if (!result?.ok) return result;
    await tx.toolCall.create({
      data: {
        workspaceId: t.workspaceId,
        turnId: id,
        name,
        argumentHash,
        result: asJson(result),
      },
    });
    if (contracts.find((v: any) => v.name === name).write)
      await audit(tx, t.workspaceId, "tool." + name, c.contactId, "agent", {
        turn_id: id,
        evidence_id: d.mensaje_evidencia_id,
      });
    return result;
  });
export const completeTurn = async (id: string, secret: string, data: any) =>
  scoped(await scopeFor(id, "turn"), async (tx) => {
    const t = await getTurn(tx, id);
    authAttempt(t, secret, data.attempt_id);
    if (data.turn_id !== id) fail(409, "TURN", "Turno diferente");
    const requestHash = digest(canonical(data));
    if (t.status === "completado") {
      if (t.completionHash !== requestHash)
        fail(
          409,
          "IDEMPOTENCY",
          "La respuesta ya fue publicada con otro contenido",
        );
      return t.result;
    }
    const c = await tx.conversation.findUniqueOrThrow({
      where: { id: t.conversationId },
    });
    if (
      t.status === "cancelado" ||
      c.controlVersion !== data.control_version ||
      !["bot", "esperando_humano"].includes(c.mode)
    )
      return { published: false, reason: "human_control" };
    active(t);
    if (
      data.knowledge_version !== t.knowledgeVersion ||
      data.record_ids.some((r: string) => !t.recordIds.includes(r))
    )
      fail(409, "REFERENCES", "Referencias no recuperadas por el turno");
    let text = data.texto;
    if (t.handoffId) {
      const cs = await tx.attentionCase.findUniqueOrThrow({
        where: { id: t.handoffId },
      });
      if (
        data.handoff_id !== cs.id ||
        cs.attemptId !== t.attemptId ||
        cs.status !== "pendiente" ||
        c.mode !== "esperando_humano" ||
        c.controlVersion !== t.controlVersion + 1
      )
        fail(409, "HANDOFF", "Pase no autorizado");
      text = ack;
    } else if (
      data.handoff_id ||
      c.mode !== "bot" ||
      data.control_version !== t.controlVersion
    )
      fail(409, "CONTROL", "Publicación no autorizada");
    const message = await append(tx, t.workspaceId, c.id, "assistant", text, {
      turnId: id,
      recordIds: data.record_ids,
    });
    const result = {
      published: true,
      response_message_id: message.id,
      response_sequence: message.sequence,
    };
    await tx.turn.update({
      where: { id },
      data: { status: "completado", completionHash: requestHash, result },
    });
    await tx.dispatch.update({
      where: { entityId: id },
      data: { status: "done", leaseUntil: null, leaseId: null },
    });
    return result;
  });
export const cancelTurn = async (
  id: string,
  secret: string,
  attemptId: string,
) =>
  scoped(await scopeFor(id, "turn"), async (tx) => {
    const t = await getTurn(tx, id);
    authAttempt(t, secret, attemptId);
    if (t.status === "completado") return { cancelled: false };
    const c = await tx.conversation.findUniqueOrThrow({
      where: { id: t.conversationId },
    });
    if (c.mode === "bot")
      fail(409, "CONTROL", "No hay toma humana que cancelar");
    await tx.turn.update({
      where: { id },
      data: { status: "cancelado", failureCode: "human_control" },
    });
    await tx.dispatch.update({
      where: { entityId: id },
      data: { status: "done" },
    });
    return { cancelled: true };
  });
export const saveSummary = async (id: string, secret: string, data: any) =>
  scoped(await scopeFor(id, "turn"), async (tx) => {
    const t = await getTurn(tx, id);
    authAttempt(t, secret, data.attempt_id);
    if (
      t.status !== "completado" ||
      !t.summaryUntil ||
      t.summaryUntil < new Date()
    )
      fail(409, "SUMMARY", "Resumen fuera de plazo");
    const c = await tx.conversation.findUniqueOrThrow({
      where: { id: t.conversationId },
    });
    const ctx = t.context as any;
    // A completed snapshot remains useful after handoff/take. Authenticate the
    // original attempt and advance monotonically; never change human control.
    if (
      data.control_version !== t.controlVersion ||
      data.through_sequence !== ctx.summary_through_sequence ||
      data.through_sequence <= c.summaryThrough
    )
      return { saved: false };
    const summary = normalizeSummary(data.resumen);
    if (!summary) fail(400, "SUMMARY", "Resumen inválido");
    await tx.conversation.update({
      where: { id: c.id },
      data: { summary: asJson(summary), summaryThrough: data.through_sequence },
    });
    return { saved: true };
  });
export const skipSummary = async (
  id: string,
  secret: string,
  attemptId: string,
) =>
  scoped(await scopeFor(id, "turn"), async (tx) => {
    const t = await getTurn(tx, id);
    authAttempt(t, secret, attemptId);
    if (t.status !== "completado") fail(409, "SUMMARY", "Turno no completado");
    await audit(tx, t.workspaceId, "summary.skipped", id, "agent");
    return { ok: true };
  });
