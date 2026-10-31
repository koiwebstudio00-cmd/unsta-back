import {
  demandFilters,
  demandDetailFilters,
  getDemand,
  getDemandContacts,
} from "./demand.js";
import express from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { db, scoped } from "./db.js";
import { config } from "./config.js";
import { HttpError, digest, canonical } from "./common.js";
import {
  login,
  credentialLogin,
  sessionAuth,
  serviceAuth,
  type Actor,
} from "./auth.js";
import * as crm from "./crm.js";
import * as agent from "./agent.js";
import * as events from "./events.js";
import { knowledge, proposals } from "./knowledge.js";
const uuid = z.string().uuid();
const id = (req: express.Request) => uuid.parse(req.params.id);
const actor = (res: express.Response) => res.locals.actor as Actor;
const secret = (req: express.Request) => req.get("X-UNSTA-Attempt-Token") ?? "";
const text = z.string().trim().min(1).max(6000);
const messageSchema = z.object({ text, client_message_id: uuid }).strict();
const claimSchema = z
  .object({
    execution_id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
    workflow_id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
    contract_version: z.literal("0.1.0"),
  })
  .strict();
const attemptSchema = z.object({ attempt_id: uuid }).strict();
export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(express.json({ limit: "64kb" }));
  app.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Request-Id", randomUUID());
    next();
  });
  app.get("/health", async (_req, res) => {
    await db.$queryRaw`SELECT 1`;
    res.json({ ok: true, service: "unsta-demo-api" });
  });
  app.post(
    "/v1/auth/accept-invite",
    rateLimit({
      windowMs: 60000,
      limit: 10,
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
    login,
  );
  app.post(
    "/v1/auth/login",
    rateLimit({
      windowMs: 60000,
      limit: 10,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: {
        error: {
          message: "Demasiados intentos. Esperá un minuto y volvé a intentar.",
        },
      },
    }),
    credentialLogin,
  );
  const panel = express.Router();
  panel.use(sessionAuth);
  panel.use(
    rateLimit({
      windowMs: 60000,
      limit: 240,
      keyGenerator: (_req, res) => actor(res).workspaceId,
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
  );
  panel.get("/me", async (_req, res) =>
    res.json({ workspace_id: actor(res).workspaceId, email: actor(res).email }),
  );
  panel.post("/logout", async (_req, res) => {
    await db.session.delete({ where: { id: actor(res).sessionId } });
    res.clearCookie("unsta_session", { path: "/" });
    res.status(204).end();
  });
  panel.get("/status", async (_req, res) =>
    res.json({
      knowledge_version: knowledge.kb.version,
      knowledge_hash: knowledge.hash,
      records: knowledge.kb.registros.length,
      dispatch_enabled: config.DISPATCH_ENABLED === "true",
      n8n_configured: Boolean(
        config.N8N_CONVERSATION_URL && config.N8N_OPENING_URL,
      ),
      n8n_live_verified: false,
    }),
  );
  panel.get("/catalog", (_req, res) => res.json({ proposals }));
  panel.get("/knowledge", (_req, res) =>
    res.json({
      records: knowledge.kb.registros.map((r: any) => ({
        id: r.id,
        title: r.titulo,
        period: r.periodo_publicado,
        conditions: r.condiciones_de_uso,
        sources: r.fuentes.map((id: string) => {
          const s = knowledge.sources.get(id) as any;
          return { title: s.titulo, url: s.url };
        }),
      })),
    }),
  );
  panel.post("/conversations", async (req, res) => {
    const b = z
      .object({ contact_id: uuid.optional() })
      .strict()
      .parse(req.body);
    res
      .status(201)
      .json(await crm.createConversation(actor(res), b.contact_id));
  });
  panel.get("/conversations/:id", async (req, res) =>
    res.json(await crm.getConversation(actor(res), id(req))),
  );
  panel.post("/conversations/:id/messages", async (req, res) => {
    const b = messageSchema.parse(req.body);
    res
      .status(202)
      .json(
        await crm.sendMessage(actor(res), id(req), b.text, b.client_message_id),
      );
  });
  panel.post("/conversations/:id/control", async (req, res) => {
    const b = z
      .object({ action: z.enum(["take", "release", "close"]) })
      .strict()
      .parse(req.body);
    res.json(await crm.control(actor(res), id(req), b.action));
  });
  panel.post("/conversations/:id/reply", async (req, res) => {
    const b = messageSchema.parse(req.body);
    res.json(
      await crm.humanReply(actor(res), id(req), b.text, b.client_message_id),
    );
  });
  panel.post("/turns/:id/retry", async (req, res) => {
    z.object({}).strict().parse(req.body);
    res.json(await crm.retryTurn(actor(res), id(req)));
  });
  panel.get("/demand", async (req, res) =>
    res.json(
      await getDemand(actor(res), demandFilters.strict().parse(req.query)),
    ),
  );
  panel.get("/demand/contacts", async (req, res) =>
    res.json(
      await getDemandContacts(
        actor(res),
        demandDetailFilters.strict().parse(req.query),
      ),
    ),
  );
  panel.get("/contacts", async (_req, res) =>
    res.json(await crm.listContacts(actor(res))),
  );
  panel.post("/contacts", async (req, res) => {
    const fields = z
      .object({
        nombre: z.string().trim().min(1).max(200),
        email: z.string().email().max(254).optional(),
        telefono: z.string().trim().min(6).max(40).optional(),
      })
      .strict()
      .parse(req.body);
    res.status(201).json(await crm.createLead(actor(res), fields));
  });
  panel.patch("/contacts/:id/stage", async (req, res) => {
    const b = z
      .object({
        stage: z.enum([
          "nuevo",
          "informado",
          "seguimiento",
          "preinscripcion_declarada",
          "inscripcion_simulada",
          "sin_interes",
        ]),
      })
      .strict()
      .parse(req.body);
    res.json(await crm.moveLead(actor(res), id(req), b.stage));
  });
  panel.get("/contacts/:id", async (req, res) =>
    res.json(await crm.getContact(actor(res), id(req))),
  );
  panel.patch("/contacts/:id", async (req, res) => {
    const b = z
      .object({
        nombre: z.string().trim().min(1).max(200).optional(),
        email: z.string().email().max(254).optional(),
        telefono: z.string().min(6).max(40).optional(),
        condicion: z.enum(["ingresante", "alumno", "otro"]).optional(),
      })
      .strict()
      .refine((x) => Object.keys(x).length > 0)
      .parse(req.body);
    res.json(await crm.editContact(actor(res), id(req), b));
  });
  panel.post("/contacts/:id/notes", async (req, res) => {
    const b = z.object({ text }).strict().parse(req.body);
    res.status(201).json(await crm.addNote(actor(res), id(req), b.text));
  });
  panel.post("/contacts/:id/tasks", async (req, res) => {
    const b = z
      .object({
        text: z.string().min(1).max(500),
        due_at: z.string().datetime(),
      })
      .strict()
      .parse(req.body);
    res
      .status(201)
      .json(await crm.addTask(actor(res), id(req), b.text, new Date(b.due_at)));
  });
  panel.patch("/tasks/:id", async (req, res) => {
    const b = z
      .object({ status: z.enum(["completada", "cancelada"]) })
      .strict()
      .parse(req.body);
    res.json(await crm.finishTask(actor(res), id(req), b.status));
  });
  panel.patch("/interests/:id", async (req, res) => {
    const b = z
      .object({
        stage: z.enum([
          "nuevo",
          "informado",
          "seguimiento",
          "preinscripcion_declarada",
          "inscripcion_simulada",
          "sin_interes",
        ]),
      })
      .strict()
      .parse(req.body);
    res.json(await crm.changeStage(actor(res), id(req), b.stage));
  });
  panel.post("/subscriptions/:id/cancel", async (req, res) => {
    z.object({}).strict().parse(req.body);
    res.json(await crm.cancelSubscription(actor(res), id(req)));
  });
  panel.post("/openings", async (req, res) => {
    const b = z
      .object({
        proposal_id: z.string().max(100),
        description: z.string().min(1).max(500),
      })
      .strict()
      .parse(req.body);
    res
      .status(201)
      .json(await crm.createOpening(actor(res), b.proposal_id, b.description));
  });
  panel.get("/followup", async (_req, res) =>
    res.json(await crm.followup(actor(res))),
  );
  app.use("/v1/demo", panel);
  const api = express.Router();
  api.use(serviceAuth);
  api.post("/turns/:id/claim", async (req, res) =>
    res.json(await agent.claimTurn(id(req), claimSchema.parse(req.body))),
  );
  api.get("/turns/:id/context", async (req, res) =>
    res.json(await agent.getContext(id(req), secret(req))),
  );
  api.post("/turns/:id/tools/:name", async (req, res) => {
    const b = z
      .object({ attempt_id: uuid, datos: z.record(z.string(), z.unknown()) })
      .strict()
      .parse(req.body);
    res.json(
      await agent.executeTool(
        id(req),
        secret(req),
        b.attempt_id,
        z.string().max(80).parse(req.params.name),
        b.datos,
      ),
    );
  });
  api.post("/turns/:id/complete", async (req, res) => {
    const b = z
      .object({
        turn_id: uuid,
        attempt_id: uuid,
        control_version: z.number().int().positive(),
        knowledge_version: z.string().max(50),
        record_ids: z.array(z.string().max(100)).max(39),
        handoff_id: uuid.nullable(),
        texto: text,
      })
      .strict()
      .parse(req.body);
    res.json(await agent.completeTurn(id(req), secret(req), b));
  });
  api.post("/turns/:id/cancel", async (req, res) => {
    const b = z
      .object({ attempt_id: uuid, reason: z.literal("control_humano") })
      .strict()
      .parse(req.body);
    res.json(await agent.cancelTurn(id(req), secret(req), b.attempt_id));
  });
  api.put("/turns/:id/summary", async (req, res) => {
    const b = z
      .object({
        attempt_id: uuid,
        resumen: z.record(z.string(), z.unknown()),
        through_sequence: z.number().int().positive(),
        control_version: z.number().int().positive(),
      })
      .strict()
      .parse(req.body);
    res.json(await agent.saveSummary(id(req), secret(req), b));
  });
  api.post("/turns/:id/summary-skipped", async (req, res) => {
    const b = z
      .object({ attempt_id: uuid, code: z.literal("SUMMARY_UNAVAILABLE") })
      .strict()
      .parse(req.body);
    res.json(await agent.skipSummary(id(req), secret(req), b.attempt_id));
  });
  api.post("/events/:id/claim", async (req, res) =>
    res.json(await events.claimEvent(id(req), claimSchema.parse(req.body))),
  );
  api.post("/events/:id/process", async (req, res) =>
    res.json(
      await events.processEvent(
        id(req),
        secret(req),
        attemptSchema.parse(req.body).attempt_id,
      ),
    ),
  );
  api.post("/incidents", async (req, res) => {
    const b = z
      .object({
        workflow_id: z
          .string()
          .regex(/^[a-zA-Z0-9_-]{1,100}$/)
          .nullable(),
        execution_id: z
          .string()
          .regex(/^[a-zA-Z0-9_-]{1,100}$/)
          .nullable(),
        node: z.string().max(80),
        code: z.enum(["N8N_TRIGGER_FAILURE", "N8N_EXECUTION_FAILURE"]),
        mensaje: z.string().max(300),
      })
      .strict()
      .parse(req.body);
    const key = digest(
      canonical([
        b.workflow_id,
        b.execution_id,
        b.code,
        b.execution_id ? null : new Date().toISOString().slice(0, 16),
      ]),
    );
    await db.incident.upsert({
      where: { dedupeKey: key },
      create: {
        dedupeKey: key,
        workflowId: b.workflow_id,
        executionId: b.execution_id,
        node: b.node,
        code: b.code,
      },
      update: {},
    });
    res.json({ ok: true });
  });
  app.use("/v1/agent", api);
  app.use((_req, res) =>
    res
      .status(404)
      .json({ error: { code: "NOT_FOUND", message: "Recurso no encontrado" } }),
  );
  app.use(
    (
      err: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      if (err instanceof z.ZodError) {
        res
          .status(400)
          .json({ error: { code: "VALIDATION", message: "Datos inválidos" } });
        return;
      }
      if (err instanceof HttpError) {
        res
          .status(err.status)
          .json({ error: { code: err.code, message: err.message } });
        return;
      }
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        ["P2002", "P2025"].includes(err.code)
      ) {
        res.status(err.code === "P2025" ? 404 : 409).json({
          error: {
            code: "CONFLICT",
            message: "Recurso no disponible o cambio en conflicto",
          },
        });
        return;
      }
      console.error(
        JSON.stringify({
          code: "API_FAILURE",
          request_id: res.getHeader("X-Request-Id"),
          type: err instanceof Error ? err.name : "Unknown",
        }),
      );
      res.status(500).json({
        error: {
          code: "INTERNAL",
          message: "No se pudo completar la operación",
        },
      });
    },
  );
  return app;
}
