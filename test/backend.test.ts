import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { createApp } from "../src/app.js";
import { db, scoped, checkRuntimeRole } from "../src/db.js";
import { newInvite } from "../src/auth.js";
import { token, digest } from "../src/common.js";
import { config } from "../src/config.js";
import { importKnowledge, knowledge } from "../src/knowledge.js";
import { recoverExpired, dispatchOnce } from "../src/worker.js";
import {
  prepareContext,
  prepareResponse,
} from "../agent-contract/runtime.mjs";
const app = createApp();
let a: any, b: any;
const metadata = () => ({
  execution_id: "test-" + randomUUID(),
  workflow_id: "workflow-test",
  contract_version: "0.1.0",
});
async function evaluator(name: string, server = app) {
  // Explicit isolated fixtures exercise RLS; real invitations share UNSTA.
  const workspace = await db.workspace.create({
    data: { name: "TEST " + name },
  });
  const secret = token();
  await db.invite.create({
    data: {
      workspaceId: workspace.id,
      email: name + "@example.test",
      tokenHash: digest(secret),
      expiresAt: new Date(Date.now() + 86400000),
    },
  });
  const invite = { workspace, token: secret };
  const agent = request.agent(server);
  const response = await agent
    .post("/v1/auth/accept-invite")
    .set("Origin", config.PANEL_ORIGIN)
    .send({ token: invite.token })
    .expect(200);
  return {
    agent,
    workspaceId: invite.workspace.id,
    csrf: response.body.csrf_token,
    invite: invite.token,
  };
}
const mutation = (
  who: any,
  method: "post" | "patch" | "put",
  path: string,
  body: any,
) =>
  who.agent[method]("/v1/demo" + path)
    .set("Origin", config.PANEL_ORIGIN)
    .set("X-CSRF-Token", who.csrf)
    .send(body);
const service = (
  method: "get" | "post" | "put",
  path: string,
  body?: any,
  claim?: any,
) => {
  let r = request(app)
    [method]("/v1/agent" + path)
    .set("Authorization", "Bearer " + config.AGENT_SERVICE_KEY);
  if (claim) r = r.set("X-UNSTA-Attempt-Token", claim.attempt_token);
  return body === undefined ? r : r.send(body);
};
async function create(
  who = a,
  text = "Quiero estudiar Psicología en Yerba Buena",
) {
  const cv = (await mutation(who, "post", "/conversations", {}).expect(201))
    .body;
  const sent = (
    await mutation(
      who,
      "post",
      `/conversations/${cv.conversation.id}/messages`,
      { text, client_message_id: randomUUID() },
    ).expect(202)
  ).body;
  return { ...cv, ...sent };
}
async function claim(id: string) {
  return (await service("post", `/turns/${id}/claim`, metadata()).expect(200))
    .body;
}
async function tool(x: any, c: any, name: string, data: any) {
  return (
    await service(
      "post",
      `/turns/${x.turn.id}/tools/${name}`,
      { attempt_id: c.attempt_id, datos: data },
      c,
    ).expect(200)
  ).body;
}
function completion(x: any, c: any, extra: any = {}) {
  return {
    turn_id: x.turn.id,
    attempt_id: c.attempt_id,
    control_version: 1,
    knowledge_version: "1.0.0",
    record_ids: [],
    handoff_id: null,
    texto: "Respuesta de prueba controlada",
    ...extra,
  };
}
before(async () => {
  await checkRuntimeRole();
  await importKnowledge();
  a = await evaluator("ana");
  b = await evaluator("beto");
});
after(async () => {
  await db.$disconnect();
});

test("invitaciones distintas comparten UNSTA y ven los cambios de otros miembros", async () => {
  const invitations = await Promise.all([
    newInvite("equipo-uno@example.test"),
    newInvite("equipo-dos@example.test"),
  ]);
  assert.equal(invitations[0].workspace.id, config.UNSTA_WORKSPACE_ID);
  assert.equal(invitations[1].workspace.id, config.UNSTA_WORKSPACE_ID);
  assert.notEqual(invitations[0].token, invitations[1].token);
  const members = [];
  for (const invite of invitations) {
    const agent = request.agent(app);
    const login = await agent
      .post("/v1/auth/accept-invite")
      .set("Origin", config.PANEL_ORIGIN)
      .send({ token: invite.token })
      .expect(200);
    members.push({ agent, csrf: login.body.csrf_token });
  }
  const created = (
    await mutation(members[0], "post", "/contacts", {
      nombre: "Lead compartido UNSTA",
      email: "compartido@example.test",
    }).expect(201)
  ).body;
  const visible = await members[1].agent.get("/v1/demo/contacts").expect(200);
  assert.ok(
    visible.body.contacts.some((c: any) => c.id === created.contact.id),
  );
  await members[1].agent
    .get(`/v1/demo/conversations/${created.conversation.id}`)
    .expect(200);
  await mutation(members[1], "patch", `/contacts/${created.contact.id}/stage`, {
    stage: "seguimiento",
  }).expect(200);
  const changed = await members[0].agent.get("/v1/demo/contacts").expect(200);
  assert.equal(
    changed.body.contacts.find((c: any) => c.id === created.contact.id)
      .pipelineStage,
    "seguimiento",
  );
  await request(app).get("/v1/demo/contacts").expect(401);
});

test("sesión con invitación de un solo uso; origen y CSRF obligatorios", async () => {
  await request(app)
    .post("/v1/auth/accept-invite")
    .set("Origin", config.PANEL_ORIGIN)
    .send({ token: a.invite })
    .expect(401);
  await a.agent.post("/v1/demo/conversations").send({}).expect(403);
  await a.agent
    .post("/v1/demo/conversations")
    .set("Origin", config.PANEL_ORIGIN)
    .send({})
    .expect(403);
  await request(app).get("/v1/demo/contacts").expect(401);
});
test("CRM: crear lead, mover pipeline y conservar etapa al editar datos", async () => {
  const created = (
    await mutation(a, "post", "/contacts", {
      nombre: "Prueba pipeline",
      email: "pipeline@example.test",
    }).expect(201)
  ).body;
  const id = created.contact.id;
  assert.equal(created.contact.pipelineStage, "nuevo");
  assert.equal(created.conversation.contactId, id);
  await mutation(a, "patch", `/contacts/${id}/stage`, {
    stage: "seguimiento",
  }).expect(200);
  await mutation(a, "patch", `/contacts/${id}`, {
    nombre: "Prueba editada",
  }).expect(200);
  const detail = (await a.agent.get(`/v1/demo/contacts/${id}`).expect(200))
    .body;
  assert.equal(detail.contact.pipelineStage, "seguimiento");
  assert.equal(detail.contact.fields.nombre, "Prueba editada");
  assert.equal(
    detail.interests.length,
    0,
    "Mover el lead no fabrica intereses ni evidencia del alumno",
  );
  const directory = (await a.agent.get("/v1/demo/contacts").expect(200)).body;
  assert.equal(
    directory.contacts.find((c: any) => c.id === id).pipelineStage,
    "seguimiento",
  );
  await mutation(a, "patch", `/contacts/${id}/stage`, {
    stage: "nuevo",
  }).expect(200);
  assert.equal(
    (await a.agent.get(`/v1/demo/contacts/${id}`).expect(200)).body.contact
      .pipelineStage,
    "nuevo",
  );
});
test("CRM: pipeline valida etapa, sesión, CSRF y aislamiento del espacio", async () => {
  const created = (
    await mutation(a, "post", "/contacts", { nombre: "Aislado" }).expect(201)
  ).body;
  const path = `/contacts/${created.contact.id}/stage`;
  await mutation(b, "patch", path, { stage: "informado" }).expect(404);
  await mutation(a, "patch", path, { stage: "inventada" }).expect(400);
  await mutation(a, "patch", path, {
    stage: "informado",
    workspaceId: b.workspaceId,
  }).expect(400);
  await request(app)
    .patch(`/v1/demo${path}`)
    .send({ stage: "informado" })
    .expect(401);
  await a.agent
    .patch(`/v1/demo${path}`)
    .set("Origin", config.PANEL_ORIGIN)
    .send({ stage: "informado" })
    .expect(403);
  await mutation(a, "post", "/contacts", {
    nombre: "",
    email: "inválido",
  }).expect(400);
  assert.equal(
    (await a.agent.get(`/v1/demo/contacts/${created.contact.id}`).expect(200))
      .body.contact.pipelineStage,
    "nuevo",
  );
});
test("RLS real: sin contexto no hay filas; otro espacio no puede leer ni escribir", async () => {
  const x = await create();
  assert.equal(await db.contact.count(), 0);
  await b.agent.get("/v1/demo/contacts/" + x.contact.id).expect(404);
  await mutation(b, "post", `/conversations/${x.conversation.id}/messages`, {
    text: "intruso",
    client_message_id: randomUUID(),
  }).expect(404);
  assert.equal(
    await scoped(b.workspaceId, (tx) =>
      tx.contact.findUnique({ where: { id: x.contact.id } }),
    ),
    null,
  );
  await assert.rejects(
    scoped(b.workspaceId, (tx) =>
      tx.contact.create({ data: { workspaceId: a.workspaceId } }),
    ),
  );
});
test("mensaje idempotente y job atómico; mismo ID con otro texto da conflicto", async () => {
  const cv = (await mutation(a, "post", "/conversations", {})).body;
  const input = { text: "Hola", client_message_id: randomUUID() };
  const [one, two] = await Promise.all([
    mutation(a, "post", `/conversations/${cv.conversation.id}/messages`, input),
    mutation(a, "post", `/conversations/${cv.conversation.id}/messages`, input),
  ]);
  assert.equal(one.status, 202);
  assert.equal(two.status, 202);
  assert.equal(one.body.message.id, two.body.message.id);
  assert.equal(one.body.turn.id, two.body.turn.id);
  assert.equal(
    await db.dispatch.count({ where: { entityId: one.body.turn.id } }),
    1,
  );
  await mutation(a, "post", `/conversations/${cv.conversation.id}/messages`, {
    ...input,
    text: "otro",
  }).expect(409);
});
test("claims concurrentes: uno solo adquiere el turno", async () => {
  const x = await create();
  const results = await Promise.all([claim(x.turn.id), claim(x.turn.id)]);
  assert.equal(results.filter((r) => r.claimed).length, 1);
});
test("credenciales de servicio e intento no permiten cruzar turnos", async () => {
  const x = await create(),
    y = await create(b),
    c = await claim(x.turn.id);
  await claim(y.turn.id);
  await request(app)
    .post("/v1/agent/turns/" + x.turn.id + "/claim")
    .send(metadata())
    .expect(401);
  await service("get", `/turns/${y.turn.id}/context`, undefined, c).expect(403);
  await service(
    "post",
    `/turns/${x.turn.id}/tools/actualizar_contacto`,
    {
      attempt_id: c.attempt_id,
      datos: {
        nombre: "Intruso",
        contact_id: y.contact.id,
        mensaje_evidencia_id: x.message.id,
      },
    },
    c,
  )
    .expect(200)
    .then((r) => assert.equal(r.body.ok, false));
});
test("metadatos de fuentes del panel requieren sesión y conservan condiciones", async () => {
  await request(app).get("/v1/demo/knowledge").expect(401);
  const response = await a.agent.get("/v1/demo/knowledge").expect(200);
  assert.equal(response.body.records.length, 39);
  for (const item of response.body.records) {
    const original = knowledge.records.get(item.id) as any;
    assert.equal(item.title, original.titulo);
    assert.deepEqual(item.conditions, original.condiciones_de_uso);
    assert.equal(item.period, original.periodo_publicado);
    assert.ok(
      item.sources.every((s: any) => s.title && /^https:\/\//.test(s.url)),
    );
  }
});
test("conocimiento HTTP conserva hash, aranceles desconocidos y condiciones; compatible con workflow", async () => {
  const x = await create(),
    c = await claim(x.turn.id);
  const ctx = (
    await service("get", `/turns/${x.turn.id}/context`, undefined, c).expect(
      200,
    )
  ).body;
  const prepared = prepareContext(
    ctx,
    c,
    {
      knowledge_version: "1.0.0",
      knowledge_hash: knowledge.hash,
      timezone: "America/Argentina/Tucuman",
    },
    new Date().toISOString(),
  );
  assert.equal(prepared.can_run, true);
  assert.equal(ctx.catalog.length, 11);
  const r = await tool(x, c, "ver_propuesta", {
    propuesta_id: "carrera-medicina",
  });
  assert.equal(r.data.registros[0].datos.arancel_cuota, null);
  assert.equal(r.data.knowledge_hash, knowledge.hash);
  assert.ok(r.data.registros[0].fuentes[0].url);
  const response = prepareResponse(
    {
      output: "Medicina requiere confirmar sus aranceles.",
      intermediateSteps: [
        { action: { tool: "ver_propuesta" }, observation: r },
      ],
    },
    prepared,
  );
  await service("post", `/turns/${x.turn.id}/complete`, response, c)
    .expect(200)
    .then((r) => assert.equal(r.body.published, true));
});
test("captura de contacto con evidencia y protección de corrección humana", async () => {
  const x = await create(a, "Me llamo Ana Perez, mi email es ana@example.test"),
    c = await claim(x.turn.id);
  assert.equal(
    (
      await tool(x, c, "actualizar_contacto", {
        nombre: "Ana Perez",
        email: "ana@example.test",
        mensaje_evidencia_id: x.message.id,
      })
    ).ok,
    true,
  );
  assert.equal(
    (
      await tool(x, c, "actualizar_contacto", {
        nombre: "Nombre inventado",
        mensaje_evidencia_id: x.message.id,
      })
    ).ok,
    false,
  );
  await mutation(a, "patch", "/contacts/" + x.contact.id, {
    nombre: "Ana corregida",
  }).expect(200);
  assert.equal(
    (
      await tool(x, c, "actualizar_contacto", {
        nombre: "Ana Perez",
        mensaje_evidencia_id: x.message.id,
      })
    ).ok,
    false,
  );
});
test("dos intereses en misma ficha, sin duplicados en retry y evidencia ajena rechazada", async () => {
  const x = await create(
      a,
      "Quiero estudiar Psicología en Yerba Buena y también me interesa Medicina",
    ),
    c = await claim(x.turn.id);
  const data = {
    propuesta_id: "carrera-psicologia",
    sede: "yerba_buena",
    mensaje_evidencia_id: x.message.id,
  };
  const r = await tool(x, c, "registrar_interes", data);
  assert.equal(r.ok, true);
  const again = await tool(x, c, "registrar_interes", data);
  assert.equal(again.data.interes.id, r.data.interes.id);
  assert.equal(
    (
      await tool(x, c, "registrar_interes", {
        propuesta_id: "carrera-medicina",
        mensaje_evidencia_id: x.message.id,
      })
    ).ok,
    true,
  );
  const other = await create(b);
  assert.equal(
    (
      await tool(x, c, "actualizar_contacto", {
        nombre: "Ana",
        mensaje_evidencia_id: other.message.id,
      })
    ).ok,
    false,
  );
  const profile = (
    await a.agent.get("/v1/demo/contacts/" + x.contact.id).expect(200)
  ).body;
  assert.equal(profile.interests.length, 2);
});
test("publicación idempotente, referencias inventadas rechazadas y lectura persistida desde PostgreSQL", async () => {
  const x = await create(),
    c = await claim(x.turn.id);
  await service(
    "post",
    `/turns/${x.turn.id}/complete`,
    completion(x, c, { record_ids: ["inventado"] }),
    c,
  ).expect(409);
  const data = completion(x, c);
  const first = await service(
    "post",
    `/turns/${x.turn.id}/complete`,
    data,
    c,
  ).expect(200);
  const second = await service(
    "post",
    `/turns/${x.turn.id}/complete`,
    data,
    c,
  ).expect(200);
  assert.equal(first.body.response_message_id, second.body.response_message_id);
  await service(
    "post",
    `/turns/${x.turn.id}/complete`,
    { ...data, texto: "otro" },
    c,
  ).expect(409);
  const read = (
    await a.agent.get("/v1/demo/conversations/" + x.conversation.id).expect(200)
  ).body;
  assert.equal(
    read.messages.filter((m: any) => m.role === "assistant").length,
    1,
  );
  const stored = await scoped(a.workspaceId, (tx) =>
    tx.message.findUnique({ where: { id: first.body.response_message_id } }),
  );
  assert.equal(stored?.text, data.texto);
});
test("toma humana cancela generación y escrituras; respuesta manual y liberación no reproducen historial", async () => {
  const x = await create(),
    c = await claim(x.turn.id);
  await mutation(a, "post", `/conversations/${x.conversation.id}/control`, {
    action: "take",
  }).expect(200);
  const result = await service(
    "post",
    `/turns/${x.turn.id}/complete`,
    completion(x, c),
    c,
  ).expect(200);
  assert.equal(result.body.published, false);
  await service(
    "post",
    `/turns/${x.turn.id}/tools/registrar_interes`,
    {
      attempt_id: c.attempt_id,
      datos: {
        propuesta_id: "carrera-psicologia",
        mensaje_evidencia_id: x.message.id,
      },
    },
    c,
  ).expect(409);
  const incoming = (
    await mutation(a, "post", `/conversations/${x.conversation.id}/messages`, {
      text: "Espero al operador",
      client_message_id: randomUUID(),
    }).expect(202)
  ).body;
  assert.equal(incoming.turn, null);
  await mutation(a, "post", `/conversations/${x.conversation.id}/reply`, {
    text: "Te atiendo como operador de la demo",
    client_message_id: randomUUID(),
  }).expect(200);
  await mutation(a, "post", `/conversations/${x.conversation.id}/control`, {
    action: "release",
  }).expect(200);
  assert.equal(
    await scoped(a.workspaceId, (tx) =>
      tx.turn.count({
        where: { conversationId: x.conversation.id, status: "encolado" },
      }),
    ),
    0,
  );
});
test("derivación sin operador crea caso y aviso canónico; caso de alumno no crea interés", async () => {
  const x = await create(
      a,
      "Soy alumno, quiero hablar con tesorería por una cuota",
    ),
    c = await claim(x.turn.id);
  const result = await tool(x, c, "derivar_a_area", {
    area: "tesoreria",
    motivo: "Consulta de alumno",
    resumen: "Solicita atención por cuotas",
    mensaje_evidencia_id: x.message.id,
  });
  assert.equal(result.ok, true);
  const complete = completion(x, c, {
    control_version: 2,
    handoff_id: result.data.caso.id,
    texto: "La universidad ya te atendió",
  });
  await service("post", `/turns/${x.turn.id}/complete`, complete, c).expect(
    200,
  );
  const read = (
    await a.agent.get("/v1/demo/conversations/" + x.conversation.id)
  ).body;
  assert.equal(read.cases[0].status, "pendiente");
  assert.match(read.messages.at(-1).text, /no se envió a la universidad/);
  assert.equal(
    (await a.agent.get("/v1/demo/contacts/" + x.contact.id)).body.interests
      .length,
    0,
  );
});
test("resumen inválido no toca la respuesta; snapshot no pierde mensajes consecutivos", async () => {
  const x = await create(),
    c = await claim(x.turn.id);
  const second = (
    await mutation(a, "post", `/conversations/${x.conversation.id}/messages`, {
      text: "¿Y el ingreso?",
      client_message_id: randomUUID(),
    }).expect(202)
  ).body;
  assert.equal((await claim(second.turn.id)).claimed, false);
  await service(
    "post",
    `/turns/${x.turn.id}/complete`,
    completion(x, c),
    c,
  ).expect(200);
  await service(
    "put",
    `/turns/${x.turn.id}/summary`,
    {
      attempt_id: c.attempt_id,
      resumen: {},
      through_sequence: 1,
      control_version: 1,
    },
    c,
  ).expect(400);
  const c2 = await claim(second.turn.id);
  const ctx = (
    await service("get", `/turns/${second.turn.id}/context`, undefined, c2)
  ).body;
  assert.ok(ctx.messages.some((m: any) => m.role === "assistant"));
  assert.equal(ctx.summary_through_sequence, 2);
  assert.equal(ctx.context_sequence, 3);
  const ready = prepareContext(
    ctx,
    c2,
    {
      knowledge_version: "1.0.0",
      knowledge_hash: knowledge.hash,
      timezone: "America/Argentina/Tucuman",
    },
    new Date().toISOString(),
  );
  assert.equal(ready.can_run, true);
});
test("avisos exigen consentimiento, cancelación efectiva y evento idempotente", async () => {
  const x = await create(
      a,
      "Avisame cuando abra Inglés A1 con un aviso simulado en el panel de la demo",
    ),
    c = await claim(x.turn.id);
  const created = await tool(x, c, "gestionar_aviso", {
    accion: "crear",
    propuesta_id: "curso-ingles-a1",
    mensaje_evidencia_id: x.message.id,
  });
  assert.equal(created.ok, true);
  const event = (
    await mutation(a, "post", "/openings", {
      proposal_id: "curso-ingles-a1",
      description: "Escenario de evaluación",
    }).expect(201)
  ).body;
  await mutation(
    a,
    "post",
    "/subscriptions/" + created.data.suscripcion.id + "/cancel",
    {},
  ).expect(200);
  const ec = (
    await service("post", "/events/" + event.id + "/claim", metadata()).expect(
      200,
    )
  ).body;
  const result = (
    await service(
      "post",
      "/events/" + event.id + "/process",
      { attempt_id: ec.attempt_id },
      ec,
    ).expect(200)
  ).body;
  assert.equal(result.data.generados, 0);
  assert.equal(result.data.omitidos, 1);
  assert.deepEqual(
    (
      await service(
        "post",
        "/events/" + event.id + "/process",
        { attempt_id: ec.attempt_id },
        ec,
      )
    ).body,
    result,
  );
  const y = await create(a, "Quiero estudiar inglés"),
    cy = await claim(y.turn.id);
  assert.equal(
    (
      await tool(y, cy, "gestionar_aviso", {
        accion: "crear",
        propuesta_id: "curso-ingles-a1",
        mensaje_evidencia_id: y.message.id,
      })
    ).ok,
    false,
  );
});
test("notas internas no llegan al contexto, tareas y etapa simulada persistentes", async () => {
  const x = await create(),
    c = await claim(x.turn.id);
  await mutation(a, "post", "/contacts/" + x.contact.id + "/notes", {
    text: "NOTA PRIVADA DEL OPERADOR",
  }).expect(201);
  const task = (
    await mutation(a, "post", "/contacts/" + x.contact.id + "/tasks", {
      text: "Revisar consulta",
      due_at: new Date(Date.now() + 86400000).toISOString(),
    }).expect(201)
  ).body;
  await mutation(a, "patch", "/tasks/" + task.id, {
    status: "completada",
  }).expect(200);
  const interest = await tool(x, c, "registrar_interes", {
    propuesta_id: "carrera-psicologia",
    mensaje_evidencia_id: x.message.id,
  });
  await mutation(a, "patch", "/interests/" + interest.data.interes.id, {
    stage: "inscripcion_simulada",
  }).expect(200);
  const ctx = (
    await service("get", "/turns/" + x.turn.id + "/context", undefined, c)
  ).body;
  assert.ok(!JSON.stringify(ctx).includes("NOTA PRIVADA"));
  const profile = (await a.agent.get("/v1/demo/contacts/" + x.contact.id)).body;
  assert.equal(profile.tasks[0].status, "completada");
  assert.equal(profile.interests[0].stage, "inscripcion_simulada");
});
test("watchdog invalida intento vencido; nuevo intento no duplica escritura ya aplicada", async () => {
  const x = await create(a, "Me llamo Lucía"),
    c = await claim(x.turn.id);
  await tool(x, c, "actualizar_contacto", {
    nombre: "Lucía",
    mensaje_evidencia_id: x.message.id,
  });
  await scoped(a.workspaceId, (tx) =>
    tx.turn.update({
      where: { id: x.turn.id },
      data: { leaseUntil: new Date(0) },
    }),
  );
  await recoverExpired();
  const next = await claim(x.turn.id);
  assert.equal(next.claimed, true);
  assert.notEqual(next.attempt_id, c.attempt_id);
  await service("get", "/turns/" + x.turn.id + "/context", undefined, c).expect(
    403,
  );
  assert.equal(
    (
      await tool(x, next, "actualizar_contacto", {
        nombre: "Lucía",
        mensaje_evidencia_id: x.message.id,
      })
    ).ok,
    true,
  );
  assert.equal(
    await scoped(a.workspaceId, (tx) =>
      tx.toolCall.count({
        where: { turnId: x.turn.id, name: "actualizar_contacto" },
      }),
    ),
    1,
  );
});
test("worker con transporte falso procesa una entrega exclusiva entre dos workers", async () => {
  // Isolated workspace so only this pending job is eligible in this assertion.
  const who = await evaluator("worker");
  const x = await create(who);
  config.N8N_CONVERSATION_URL = "https://n8n-test.example.test/webhook/demo";
  const calls: string[] = [];
  const fake: typeof fetch = async (_url, init) => {
    const data = JSON.parse(String(init?.body));
    calls.push(data.turn_id);
    await claim(data.turn_id);
    return new Response('{"accepted":true}', { status: 202 });
  };
  await Promise.all([dispatchOnce(fake), dispatchOnce(fake)]);
  assert.equal(calls.filter((t) => t === x.turn.id).length, 1);
  config.N8N_CONVERSATION_URL = "";
});

test("apertura con consentimiento genera aviso interno una vez y nunca entrega externa", async () => {
  const who = await evaluator("avisos");
  const x = await create(
      who,
      "Avisame cuando abra Italiano A1 con un aviso simulado en el panel de la demo",
    ),
    c = await claim(x.turn.id);
  const sub = await tool(x, c, "gestionar_aviso", {
    accion: "crear",
    propuesta_id: "curso-italiano-a1",
    mensaje_evidencia_id: x.message.id,
  });
  assert.equal(sub.ok, true);
  const event = (
    await mutation(who, "post", "/openings", {
      proposal_id: "curso-italiano-a1",
      description: "Ejemplo ficticio",
    }).expect(201)
  ).body;
  const ec = (
    await service("post", "/events/" + event.id + "/claim", metadata())
  ).body;
  const [r1, r2] = await Promise.all([
    service(
      "post",
      "/events/" + event.id + "/process",
      { attempt_id: ec.attempt_id },
      ec,
    ),
    service(
      "post",
      "/events/" + event.id + "/process",
      { attempt_id: ec.attempt_id },
      ec,
    ),
  ]);
  assert.equal(r1.status, 200);
  assert.deepEqual(r1.body, r2.body);
  assert.equal(r1.body.data.generados, 1);
  const notices = await scoped(who.workspaceId, (tx) =>
    tx.notice.findMany({ where: { eventId: event.id } }),
  );
  assert.equal(notices.length, 1);
  assert.equal(notices[0].simulated, true);
});
test("202 sin claim termina en fallo acotado; operador puede reintentar explícitamente", async () => {
  const who = await evaluator("timeout");
  const x = await create(who);
  await db.dispatch.update({
    where: { entityId: x.turn.id },
    data: { status: "accepted", attempts: 3, leaseUntil: new Date(0) },
  });
  await recoverExpired();
  const t = await scoped(who.workspaceId, (tx) =>
    tx.turn.findUniqueOrThrow({ where: { id: x.turn.id } }),
  );
  assert.equal(t.status, "fallido");
  assert.equal(t.failureCode, "CLAIM_TIMEOUT");
  await mutation(who, "post", "/turns/" + x.turn.id + "/retry", {}).expect(200);
  assert.equal((await claim(x.turn.id)).claimed, true);
});
test("resumen válido persiste, otro horizonte y toma humana no lo sobrescriben", async () => {
  const who = await evaluator("resumen");
  const x = await create(who),
    c = await claim(x.turn.id);
  await service(
    "post",
    "/turns/" + x.turn.id + "/complete",
    completion(x, c),
    c,
  ).expect(200);
  const data = {
    attempt_id: c.attempt_id,
    resumen: { intereses: ["Psicología"] },
    through_sequence: 1,
    control_version: 1,
  };
  assert.equal(
    (
      await service("put", "/turns/" + x.turn.id + "/summary", data, c).expect(
        200,
      )
    ).body.saved,
    true,
  );
  assert.equal(
    (
      await service(
        "put",
        "/turns/" + x.turn.id + "/summary",
        { ...data, through_sequence: 2 },
        c,
      )
    ).body.saved,
    false,
  );
  await mutation(
    who,
    "post",
    "/conversations/" + x.conversation.id + "/control",
    { action: "take" },
  );
  assert.equal(
    (
      await service(
        "put",
        "/turns/" + x.turn.id + "/summary",
        { ...data, resumen: { nombre: "Inventado" } },
        c,
      )
    ).body.saved,
    false,
  );
});
test("cancelación invalida respuesta almacenada de una suscripción previa", async () => {
  const who = await evaluator("cancel");
  const x = await create(
      who,
      "Avisame cuando abra Inglés A1 con un aviso simulado en el panel de la demo",
    ),
    c = await claim(x.turn.id);
  const data = {
    accion: "crear",
    propuesta_id: "curso-ingles-a1",
    mensaje_evidencia_id: x.message.id,
  };
  const result = await tool(x, c, "gestionar_aviso", data);
  await mutation(
    who,
    "post",
    "/subscriptions/" + result.data.suscripcion.id + "/cancel",
    {},
  ).expect(200);
  const replay = await tool(x, c, "gestionar_aviso", data);
  assert.equal(replay.ok, false);
  assert.equal(replay.error.code, "STATE_CHANGED");
});

test("avisos reconocen autorización explícita natural y rechazan negación o falta de permiso", async () => {
  for (const [text, expected] of [
    [
      "Me refiero a una nueva edición de Inglés A1 en Central. Sí, autorizo que registres un aviso simulado en este panel cuando abra esa propuesta.",
      true,
    ],
    [
      "Sí, confirmo: quiero que me avises cuando abra una nueva edición de Inglés A1 en Central. Autorizo el aviso simulado en este panel. Registralo ahora.",
      true,
    ],
    ["Autorizo el aviso simulado de Inglés A1 en este panel", true],
    ["No autorizo el aviso simulado de Inglés A1 en este panel", false],
    ["Me interesa Inglés A1 y quiero información del panel", false],
    ["Avisame cuando abra Inglés A1", false],
  ] as const) {
    const x = await create(a, text),
      c = await claim(x.turn.id);
    const result = await tool(x, c, "gestionar_aviso", {
      accion: "crear",
      propuesta_id: "curso-ingles-a1",
      mensaje_evidencia_id: x.message.id,
    });
    assert.equal(result.ok, expected, text);
  }
});
test("sí confirmo acepta solo la pregunta inmediata del curso y aviso simulado", async () => {
  for (const [question, expected] of [
    ["¿Confirmás el aviso simulado de Inglés A1 en el panel?", true],
    ["¿Confirmás el aviso simulado de Portugués A1 en el panel?", false],
    [
      "¿Confirmás el aviso simulado de Inglés A1 o Portugués A1 en el panel?",
      false,
    ],
    ["¿Querés información de Inglés A1?", false],
  ] as const) {
    const x = await create(a, "Me interesa Inglés A1"),
      c = await claim(x.turn.id);
    await service(
      "post",
      `/turns/${x.turn.id}/complete`,
      completion(x, c, { texto: question }),
      c,
    ).expect(200);
    const next = (
      await mutation(
        a,
        "post",
        `/conversations/${x.conversation.id}/messages`,
        { text: "Sí, confirmo.", client_message_id: randomUUID() },
      ).expect(202)
    ).body;
    const nc = await claim(next.turn.id);
    const result = await tool(next, nc, "gestionar_aviso", {
      accion: "crear",
      propuesta_id: "curso-ingles-a1",
      mensaje_evidencia_id: next.message.id,
    });
    assert.equal(result.ok, expected, question);
  }
});

test("captura teléfono/email declarados antes del modelo y conserva evidencia e idempotencia", async () => {
  const x = await create(
    a,
    "Me interesa Social Media Marketing. Mi teléfono ficticio de prueba es +54 9 381 555-0199. Mi email es captura@example.test.",
  );
  const c = await claim(x.turn.id);
  const profile = (
    await a.agent.get("/v1/demo/contacts/" + x.contact.id).expect(200)
  ).body;
  assert.equal(profile.contact.fields.telefono, "+54 9 381 555-0199");
  assert.equal(profile.contact.fields.email, "captura@example.test");
  const ctx = (
    await service("get", `/turns/${x.turn.id}/context`, undefined, c).expect(
      200,
    )
  ).body;
  assert.equal(ctx.contact.telefono, "+54 9 381 555-0199");
  const replay = await tool(x, c, "actualizar_contacto", {
    telefono: "+54 9 381 555-0199",
    email: "captura@example.test",
    mensaje_evidencia_id: x.message.id,
  });
  assert.equal(replay.ok, true);
  const again = await claim(x.turn.id);
  assert.equal(again.claimed, false);
  const calls = await scoped(a.workspaceId, (tx) =>
    tx.toolCall.findMany({
      where: { turnId: x.turn.id, name: "actualizar_contacto" },
    }),
  );
  assert.equal(calls.length, 1);
});

test("captura respeta teléfono protegido y no toma números ajenos, negados, ambiguos o preguntas", async () => {
  for (const text of [
    "No, mi teléfono no es +5493815550199.",
    "El teléfono de mi madre es +5493815550199.",
    "Mi teléfono es +5493815550199?",
    "Mi teléfono es +5493815550199 o +5493815550200.",
    "Si mi teléfono es +5493815550199, ¿qué pasa?",
  ]) {
    const x = await create(a, text);
    await claim(x.turn.id);
    const p = (await a.agent.get("/v1/demo/contacts/" + x.contact.id)).body;
    assert.equal(p.contact.fields.telefono, undefined, text);
  }
  const x = await create(
    a,
    "Mi teléfono es +5493815550199. Mi email es protegido@example.test.",
  );
  await mutation(a, "patch", "/contacts/" + x.contact.id, {
    telefono: "+5493815550000",
  }).expect(200);
  await claim(x.turn.id);
  const p = (await a.agent.get("/v1/demo/contacts/" + x.contact.id)).body;
  assert.equal(p.contact.fields.telefono, "+5493815550000");
  assert.equal(p.contact.fields.email, "protegido@example.test");
});

test("interés libre que coincide con catálogo se vincula, reutiliza fila anterior y no duplica", async () => {
  const x = await create(a, "Me interesa Social Media Marketing.");
  const legacy = await scoped(a.workspaceId, (tx) =>
    tx.interest.create({
      data: {
        workspaceId: a.workspaceId,
        contactId: x.contact.id,
        identity: "qa-legacy-" + randomUUID(),
        data: { propuesta_libre: "Social Media Marketing" },
        evidenceId: x.message.id,
        stage: "seguimiento",
      },
    }),
  );
  const c = await claim(x.turn.id);
  const args = {
    propuesta_libre: "Social Media Marketing",
    mensaje_evidencia_id: x.message.id,
  };
  const first = await tool(x, c, "registrar_interes", args);
  assert.equal(first.ok, true);
  assert.equal(first.data.interes.id, legacy.id);
  assert.deepEqual(first.data.interes.data, {
    propuesta_id: "curso-social-media",
  });
  assert.equal(first.data.interes.stage, "seguimiento");
  const second = await tool(x, c, "registrar_interes", {
    propuesta_id: "curso-social-media",
    mensaje_evidencia_id: x.message.id,
  });
  assert.equal(second.data.interes.id, legacy.id);
  const p = (await a.agent.get("/v1/demo/contacts/" + x.contact.id)).body;
  assert.equal(p.interests.length, 1);
});

test("catálogo no fuerza coincidencias ambiguas ni ofertas desconocidas y respeta correcciones", async () => {
  const x = await create(a, "Me interesa Marketing y Astronomía.");
  const c = await claim(x.turn.id);
  const ambiguous = await tool(x, c, "registrar_interes", {
    propuesta_libre: "Marketing",
    mensaje_evidencia_id: x.message.id,
  });
  assert.equal(ambiguous.error.code, "PROPOSAL_AMBIGUOUS");
  const unknown = await tool(x, c, "registrar_interes", {
    propuesta_libre: "Astronomía",
    mensaje_evidencia_id: x.message.id,
  });
  assert.equal(unknown.data.interes.data.propuesta_libre, "Astronomía");
  const y = await create(a, "Me interesa Social Media Marketing.");
  await scoped(a.workspaceId, (tx) =>
    tx.interest.create({
      data: {
        workspaceId: a.workspaceId,
        contactId: y.contact.id,
        identity: "qa-protected-" + randomUUID(),
        data: { propuesta_libre: "Social Media Marketing" },
        protectedFields: true,
        evidenceId: y.message.id,
      },
    }),
  );
  const d = await claim(y.turn.id);
  assert.equal(
    (
      await tool(y, d, "registrar_interes", {
        propuesta_id: "curso-social-media",
        mensaje_evidencia_id: y.message.id,
      })
    ).error.code,
    "MANUAL_OVERRIDE",
  );
});

test("interés explícito se captura antes de responder y no depende de una llamada del modelo", async () => {
  const x = await create(
    a,
    "Hola, me interesa Social Media Marketing. Mi teléfono es +5493815550201. ¿Es virtual?",
  );
  const c = await claim(x.turn.id);
  const ctx = (
    await service("get", `/turns/${x.turn.id}/context`, undefined, c).expect(
      200,
    )
  ).body;
  assert.equal(ctx.interests.length, 1);
  assert.equal(ctx.interests[0].propuesta_id, "curso-social-media");
  const retry = await tool(x, c, "registrar_interes", {
    propuesta_libre: "Social Media Marketing",
    mensaje_evidencia_id: x.message.id,
  });
  assert.equal(retry.ok, true);
  const p = (await a.agent.get("/v1/demo/contacts/" + x.contact.id)).body;
  assert.equal(p.interests.length, 1);
  assert.equal(p.interests[0].data.propuesta_libre, undefined);
  for (const text of [
    "No me interesa Social Media Marketing.",
    "Me interesa Marketing.",
    "Me interesa Social Media o Nutrición Deportiva.",
    "¿Me interesa Social Media Marketing?",
    "Mi amigo dijo: me interesa Social Media Marketing.",
  ]) {
    const y = await create(a, text);
    await claim(y.turn.id);
    assert.equal(
      (await a.agent.get("/v1/demo/contacts/" + y.contact.id)).body.interests
        .length,
      0,
      text,
    );
  }
});

test("demanda: personas únicas, pendientes, sede/fecha en el mismo interés y acceso al CRM", async () => {
  const who = await evaluator("demanda-" + randomUUID(), createApp());
  const source = await create(who, "Fixture de demanda");
  const ids = [randomUUID(), randomUUID(), randomUUID()];
  const now = new Date();
  const old = new Date(now.getTime() - 40 * 86400000);
  await scoped(who.workspaceId, async (tx) => {
    await tx.contact.createMany({
      data: ids.map((id, index) => ({
        id,
        workspaceId: who.workspaceId,
        fields: { nombre: "Demanda " + index },
        pipelineStage: ["nuevo", "informado", "seguimiento"][index],
      })),
    });
    const fixture = [
      [ids[0], "curso-social-media", "central", now],
      [ids[0], "curso-social-media", "yerba_buena", old],
      [ids[1], "curso-social-media", "central", now],
      [ids[2], "carrera-medicina", "yerba_buena", now],
      [ids[0], "carrera-medicina", "yerba_buena", now],
      [ids[2], null, "central", now],
    ];
    for (const [contactId, proposalId, sede, createdAt] of fixture)
      await tx.interest.create({
        data: {
          workspaceId: who.workspaceId,
          contactId: contactId as string,
          identity: randomUUID(),
          data: proposalId
            ? { propuesta_id: proposalId, sede }
            : { propuesta_libre: "Astronomía", sede },
          evidenceId: source.message.id,
          createdAt: createdAt as Date,
        },
      });
  });
  const result = (await who.agent.get("/v1/demo/demand").expect(200)).body;
  assert.equal(result.people, 3);
  assert.equal(result.unmappedPeople, 1);
  const social = result.rows.find(
    (r: any) => r.proposalId === "curso-social-media",
  );
  assert.equal(social.interested, 2);
  assert.equal(social.pending, 1);
  assert.equal(
    result.rows.find((r: any) => r.proposalId === "carrera-medicina").pending,
    2,
  );
  const filtered = (
    await who.agent
      .get("/v1/demo/demand?days=30&sede=yerba_buena&kind=cursos")
      .expect(200)
  ).body;
  assert.equal(
    filtered.rows.length,
    0,
    "No combinar sede de otro registro con fecha reciente",
  );
  const crm = (
    await who.agent
      .get(
        "/v1/demo/demand/contacts?proposal_id=curso-social-media&pending=true",
      )
      .expect(200)
  ).body;
  assert.deepEqual(
    crm.contacts.map((c: any) => c.id),
    [ids[0]],
  );
  await mutation(who, "patch", `/contacts/${ids[0]}/stage`, {
    stage: "informado",
  }).expect(200);
  const moved = (await who.agent.get("/v1/demo/demand").expect(200)).body;
  assert.equal(
    moved.rows.find((r: any) => r.proposalId === "curso-social-media").pending,
    0,
  );
  assert.equal(
    (
      await who.agent.get(
        "/v1/demo/demand/contacts?proposal_id=curso-social-media&pending=true",
      )
    ).body.contacts.length,
    0,
  );
  await request(app).get("/v1/demo/demand").expect(401);
  await who.agent.get("/v1/demo/demand?days=365").expect(400);
  await who.agent.get("/v1/demo/demand/contacts?proposal_id=otra").expect(400);
  const other = (
    await b.agent
      .get("/v1/demo/demand/contacts?proposal_id=curso-social-media")
      .expect(200)
  ).body;
  assert.ok(other.contacts.every((c: any) => !ids.includes(c.id)));
});

test("demanda y detalle incluyen más de 200 contactos sin truncar ni desalinear totales", async () => {
  const who = await evaluator("demanda-volumen-" + randomUUID(), createApp());
  const source = await create(who, "Fixture aislada");
  const ids = Array.from({ length: 205 }, () => randomUUID());
  await scoped(who.workspaceId, async (tx) => {
    await tx.contact.createMany({
      data: ids.map((id) => ({
        id,
        workspaceId: who.workspaceId,
        fields: { nombre: "Volumen QA" },
      })),
    });
    await tx.interest.createMany({
      data: ids.map((contactId) => ({
        workspaceId: who.workspaceId,
        contactId,
        identity: "demanda",
        data: { propuesta_id: "curso-social-media" },
        evidenceId: source.message.id,
      })),
    });
  });
  const ranking = (await who.agent.get("/v1/demo/demand").expect(200)).body;
  assert.equal(ranking.rows[0].interested, 205);
  assert.equal(ranking.rows[0].pending, 205);
  assert.equal(
    (
      await who.agent
        .get("/v1/demo/demand/contacts?proposal_id=curso-social-media")
        .expect(200)
    ).body.contacts.length,
    205,
  );
});
