import type { Message } from "@prisma/client";
import { db, scoped, asJson, type Tx } from "./db.js";
import { normalize } from "./common.js";
import { knowledge } from "./knowledge.js";
import { mentionedProposals } from "./capture.js";

export const FOLLOWUP_INTERVAL_MS = 2 * 60 * 60 * 1000;
const eligibleStages = ["nuevo", "informado", "seguimiento"];

export function stopSignal(text: string) {
  const n = normalize(text);
  return /\b(no me (?:escribas|contactes|mandes|envies)|deja de (?:escribirme|contactarme)|no quiero (?:mas mensajes|que me escribas)|dame de baja)\b/.test(
    n,
  );
}
export function closedInquiry(text: string) {
  const n = normalize(text).trim();
  return (
    stopSignal(text) ||
    /\b(no me interesa|no quiero (?:seguir|estudiar|inscribirme)|soy (?:alumno|alumna|estudiante)\b)/.test(
      n,
    ) ||
    /^(?:muchas )?gracias(?:[,.! ]+(?:nada mas|eso es todo|hasta luego|chau|listo))?[.! ]*$/.test(
      n,
    )
  );
}

// Context changes wording, never institutional facts. Messages are newest first;
// a short continuation can inherit the last concrete topic, but a new topic wins.
export function composeFollowup(
  userMessages: string[],
  knownTitles: string[],
  sentCount: number,
) {
  const current = normalize(userMessages[0] ?? "").trim();
  if (
    /^(hola|buenas|buen dia|buenos dias|buenas tardes|buenas noches)(?:[!, .¿?]*(?:como (?:estas|estan)|que tal))?[!.¿? ]*$/.test(
      current,
    )
  ) {
    return {
      kind: "saludo",
      text:
        sentCount === 0
          ? "¡Hola! ¿Estás buscando una carrera o querés consultar algo sobre UNSTA? Contame y te ayudo a orientarte."
          : "Si necesitás orientación sobre UNSTA, podés contarme qué estás buscando y seguimos por acá.",
    };
  }
  const patterns: [string, RegExp][] = [
    [
      "aranceles",
      /\b(arancel\w*|cuotas?|precios?|costos?|cuanto cuesta|matricula|becas?|pagos?)\b/,
    ],
    ["horarios", /\b(horarios?|turnos?|dias de cursado|a que hora)\b/],
    [
      "ingreso",
      /\b(requisitos?|documentacion|inscri\w*|preinscri\w*|ingreso|ingresar|examen|tramite)\b/,
    ],
    [
      "plan de estudios",
      /\b(materias?|plan de estudios|duracion|cuanto dura|cuantos anos|que se estudia)\b/,
    ],
    [
      "modalidad y sede",
      /\b(modalidad|virtual|presencial|sedes?|donde se cursa)\b/,
    ],
  ];
  let topics: string[] = [];
  for (const message of userMessages) {
    topics = patterns
      .filter(([, pattern]) => pattern.test(normalize(message)))
      .map(([label]) => label);
    if (topics.length || mentionedProposals(message).length) break;
  }
  const mentioned = userMessages
    .map(mentionedProposals)
    .find((items) => items.length);
  const titles = mentioned
    ? mentioned.map((p: { titulo: string }) => p.titulo)
    : knownTitles;
  const career = titles.length === 1 ? titles[0] : "";
  const topic = topics.slice(0, 2).join(" y ");
  if (topic) {
    const subject = `${topic}${career ? ` de ${career}` : ""}`;
    return {
      kind: topics.join("+"),
      text:
        sentCount === 0
          ? `¿Te quedó algo por aclarar sobre ${subject}? Podemos retomar la consulta desde ahí.`
          : `Si todavía estás evaluando ${subject}, podemos seguir por acá cuando quieras. ¿Qué te falta saber para avanzar?`,
    };
  }
  if (career)
    return {
      kind: "carrera",
      text:
        sentCount === 0
          ? `¿Querés que sigamos viendo ${career}? Contame qué te gustaría saber para ver si se ajusta a lo que buscás.`
          : `Si todavía estás pensando en ${career}, podemos retomar cuando quieras. ¿Hay algo que te falte saber para decidir?`,
    };
  return {
    kind: "consulta_general",
    text:
      sentCount === 0
        ? "¿Te quedó alguna duda de lo que veníamos conversando? Contame qué necesitás aclarar y seguimos por ahí."
        : "Podemos retomar tu consulta cuando quieras. Si todavía necesitás ayuda, escribime por acá.",
  };
}

async function log(
  tx: Tx,
  workspaceId: string,
  contactId: string,
  kind: string,
  data: unknown,
) {
  await tx.audit.create({
    data: {
      workspaceId,
      entityId: contactId,
      kind,
      actor: "agent",
      data: asJson(data),
    },
  });
}
export async function autoStage(
  tx: Tx,
  workspaceId: string,
  contactId: string,
  stage: string,
  reason: string,
  evidenceId?: string,
) {
  const contact = await tx.contact.findUniqueOrThrow({
    where: { id: contactId },
  });
  if (
    contact.protectedFields.includes("pipelineStage") ||
    contact.pipelineStage === stage
  )
    return;
  // Also respect manual edits made before this feature existed.
  if (
    await tx.audit.findFirst({
      where: { entityId: contactId, kind: "contact.pipeline" },
      select: { id: true },
    })
  )
    return;
  // A completed/manual enrollment must never be downgraded by automation.
  if (
    ["inscripcion_simulada", "preinscripcion_declarada"].includes(
      contact.pipelineStage,
    )
  )
    return;
  await tx.contact.update({
    where: { id: contactId },
    data: { pipelineStage: stage },
  });
  await log(tx, workspaceId, contactId, "contact.pipeline.automatic", {
    from: contact.pipelineStage,
    to: stage,
    reason,
    evidence_id: evidenceId,
  });
}

export async function cancelFollowup(
  tx: Tx,
  contactId: string,
  reason: string,
) {
  await tx.leadFollowup.updateMany({
    where: { contactId, status: { in: ["awaiting_response", "scheduled"] } },
    data: { status: "cancelled", dueAt: null, reason },
  });
}

// Called in the same workspace transaction as the incoming message. One cycle
// per contact prevents parallel conversations from sending duplicate reminders.
export async function receiveLeadMessage(
  tx: Tx,
  contactId: string,
  message: Message,
  bot: boolean,
) {
  const previous = await tx.leadFollowup.findUnique({ where: { contactId } });
  const optOut = stopSignal(message.text) || previous?.status === "opted_out";
  const status = optOut
    ? "opted_out"
    : !bot || closedInquiry(message.text)
      ? "cancelled"
      : "awaiting_response";
  const data = {
    conversationId: message.conversationId,
    messageId: message.id,
    sentCount: 0,
    dueAt: null,
    status,
    reason: optOut
      ? "do_not_contact"
      : !bot
        ? "human_control"
        : closedInquiry(message.text)
          ? "inquiry_closed"
          : "new_incoming",
  };
  await tx.leadFollowup.upsert({
    where: { contactId },
    create: { workspaceId: message.workspaceId, contactId, ...data },
    update: data,
  });
  if (
    optOut ||
    /^\s*(?:ya )?no me interesa(?:\s+(?:nada|seguir))?[.! ]*$/i.test(
      normalize(message.text),
    )
  ) {
    await autoStage(
      tx,
      message.workspaceId,
      contactId,
      "sin_interes",
      "explicit_decline",
      message.id,
    );
  } else if (previous?.status === "exhausted") {
    await autoStage(
      tx,
      message.workspaceId,
      contactId,
      "informado",
      "lead_returned",
      message.id,
    );
  }
}

export async function interestDetected(
  tx: Tx,
  workspaceId: string,
  contactId: string,
  evidenceId: string,
  preinscription: boolean,
) {
  const cycle = await tx.leadFollowup.findUnique({ where: { contactId } });
  if (
    !cycle ||
    cycle.messageId !== evidenceId ||
    !["awaiting_response", "scheduled"].includes(cycle.status)
  )
    return;
  await autoStage(
    tx,
    workspaceId,
    contactId,
    preinscription ? "preinscripcion_declarada" : "informado",
    preinscription ? "declared_preinscription" : "interest_with_evidence",
    evidenceId,
  );
  if (preinscription)
    await cancelFollowup(tx, contactId, "declared_preinscription");
}

async function eligible(tx: Tx, contactId: string, conversationId: string) {
  const contact = await tx.contact.findUniqueOrThrow({
    where: { id: contactId },
  });
  if (!eligibleStages.includes(contact.pipelineStage)) return false;
  if ((contact.fields as any).condicion === "alumno") return false;
  const conversations = await tx.conversation.findMany({
    where: { contactId },
  });
  if (
    conversations.find((c) => c.id === conversationId)?.mode !== "bot" ||
    conversations.some((c) => ["humano", "esperando_humano"].includes(c.mode))
  )
    return false;
  const ids = conversations.map((c) => c.id);
  if (
    await tx.attentionCase.count({
      where: {
        conversationId: { in: ids },
        status: { in: ["pendiente", "tomado"] },
      },
    })
  )
    return false;
  if (
    await tx.turn.count({
      where: {
        conversationId: { in: ids },
        status: { in: ["encolado", "procesando"] },
      },
    })
  )
    return false;
  return true;
}

// Only a successfully published answer can arm a cycle. Failed or older turns
// must not chase a lead who is still waiting for us to answer.
export async function armFollowup(
  tx: Tx,
  contactId: string,
  messageId: string,
  now = new Date(),
) {
  const cycle = await tx.leadFollowup.findUnique({ where: { contactId } });
  if (
    !cycle ||
    cycle.messageId !== messageId ||
    cycle.status !== "awaiting_response"
  )
    return;
  if (!(await eligible(tx, contactId, cycle.conversationId))) return;
  await autoStage(
    tx,
    cycle.workspaceId,
    contactId,
    "informado",
    "answer_published",
    messageId,
  );
  const anchor = await tx.message.findUniqueOrThrow({
    where: { id: messageId },
  });
  // If answering was delayed, allow the lead a full interval after our answer.
  const nominal = anchor.createdAt.getTime() + FOLLOWUP_INTERVAL_MS;
  const dueAt = new Date(
    nominal > now.getTime() ? nominal : now.getTime() + FOLLOWUP_INTERVAL_MS,
  );
  await tx.leadFollowup.update({
    where: { id: cycle.id },
    data: { status: "scheduled", dueAt, reason: "awaiting_lead" },
  });
  await log(tx, cycle.workspaceId, contactId, "followup.scheduled", {
    message_id: messageId,
    due_at: dueAt,
  });
}

export async function runLeadFollowups(now = new Date()) {
  const workspaces = await db.workspace.findMany({ select: { id: true } });
  for (const ws of workspaces) {
    // Workspace lock serializes incoming messages, manual edits and workers.
    await scoped(ws.id, async (tx) => {
      const cycles = await tx.leadFollowup.findMany({
        where: { status: "scheduled", dueAt: { lte: now } },
        orderBy: { dueAt: "asc" },
        take: 50,
      });
      for (const cycle of cycles) {
        if (!(await eligible(tx, cycle.contactId, cycle.conversationId))) {
          await cancelFollowup(tx, cycle.contactId, "no_longer_eligible");
          continue;
        }
        if (cycle.sentCount === 2) {
          await autoStage(
            tx,
            ws.id,
            cycle.contactId,
            "sin_interes",
            "no_reply_after_two_followups",
            cycle.messageId,
          );
          await tx.leadFollowup.update({
            where: { id: cycle.id },
            data: {
              status: "exhausted",
              dueAt: null,
              reason: "no_reply_after_two_followups",
            },
          });
          await log(tx, ws.id, cycle.contactId, "followup.exhausted", {
            message_id: cycle.messageId,
          });
          continue;
        }
        const interests = await tx.interest.findMany({
          where: { contactId: cycle.contactId, stage: { not: "sin_interes" } },
          orderBy: { updatedAt: "desc" },
        });
        const titles = [
          ...new Set(
            interests
              .map(
                (i) =>
                  knowledge.records.get((i.data as any).propuesta_id)?.titulo,
              )
              .filter(Boolean),
          ),
        ];
        const anchor = await tx.message.findUniqueOrThrow({
          where: { id: cycle.messageId },
        });
        const history = await tx.message.findMany({
          where: {
            conversationId: cycle.conversationId,
            role: "user",
            sequence: { lte: anchor.sequence },
          },
          orderBy: { sequence: "desc" },
          take: 5,
        });
        const { text, kind } = composeFollowup(
          history.map((m) => m.text),
          titles as string[],
          cycle.sentCount,
        );
        const cv = await tx.conversation.update({
          where: { id: cycle.conversationId },
          data: { sequence: { increment: 1 } },
        });
        const message = await tx.message.create({
          data: {
            workspaceId: ws.id,
            conversationId: cv.id,
            role: "assistant",
            text,
            sequence: cv.sequence,
            clientMessageId: `followup:${cycle.messageId}:${cycle.sentCount + 1}`,
          },
        });
        await tx.leadFollowup.update({
          where: { id: cycle.id },
          data: {
            sentCount: { increment: 1 },
            dueAt: new Date(now.getTime() + FOLLOWUP_INTERVAL_MS),
            reason: "awaiting_lead",
          },
        });
        await autoStage(
          tx,
          ws.id,
          cycle.contactId,
          "seguimiento",
          "automatic_followup",
          cycle.messageId,
        );
        await log(tx, ws.id, cycle.contactId, "followup.sent", {
          number: cycle.sentCount + 1,
          message_id: message.id,
          anchor_message_id: cycle.messageId,
          context_kind: kind,
        });
      }
    });
  }
}
