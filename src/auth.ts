import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db } from "./db.js";
import { config } from "./config.js";
import { digest, token, equal, fail } from "./common.js";
import { verifyPassword, dummyHash } from "./password.js";
export type Actor = { workspaceId: string; email: string; sessionId: string };
export function checkOrigin(req: Request) {
  if (req.get("origin") !== config.PANEL_ORIGIN)
    fail(403, "ORIGIN", "Origen no autorizado");
}
export async function login(req: Request, res: Response) {
  checkOrigin(req);
  const body = z
    .object({ token: z.string().regex(/^[a-f0-9]{64}$/) })
    .strict()
    .parse(req.body);
  const secret = token(),
    csrf = token();
  const session = await db.$transaction(async (tx) => {
    const invite = await tx.invite.findUnique({
      where: { tokenHash: digest(body.token) },
    });
    if (!invite || invite.usedAt || invite.expiresAt < new Date())
      fail(401, "INVITE", "Invitación inválida o vencida");
    const updated = await tx.invite.updateMany({
      where: { id: invite.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (updated.count !== 1) fail(401, "INVITE", "Invitación ya utilizada");
    return tx.session.create({
      data: {
        tokenHash: digest(secret),
        csrfHash: digest(csrf),
        workspaceId: invite.workspaceId,
        email: invite.email,
        expiresAt: new Date(Date.now() + 7 * 86400000),
      },
    });
  });
  res.cookie("unsta_session", secret, {
    httpOnly: true,
    secure: config.COOKIE_SECURE === "true",
    sameSite: "lax",
    path: "/",
    maxAge: 7 * 86400000,
  });
  res.json({
    workspace_id: session.workspaceId,
    email: session.email,
    csrf_token: csrf,
  });
}
export async function credentialLogin(req: Request, res: Response) {
  checkOrigin(req);
  const body = z
    .object({
      email: z.string().trim().toLowerCase().email().max(254),
      password: z.string().min(1).max(128),
    })
    .strict()
    .parse(req.body);
  const account = await db.account.findUnique({ where: { email: body.email } });
  const valid = await verifyPassword(
    body.password,
    account?.passwordHash ?? dummyHash,
  );
  if (!account || !valid)
    fail(401, "CREDENTIALS", "Email o contraseña incorrectos");
  const secret = token(),
    csrf = token();
  const session = await db.session.create({
    data: {
      tokenHash: digest(secret),
      csrfHash: digest(csrf),
      workspaceId: account.workspaceId,
      email: account.email,
      expiresAt: new Date(Date.now() + 7 * 86400000),
    },
  });
  res.cookie("unsta_session", secret, {
    httpOnly: true,
    secure: config.COOKIE_SECURE === "true",
    sameSite: "lax",
    path: "/",
    maxAge: 7 * 86400000,
  });
  res.json({
    workspace_id: session.workspaceId,
    email: session.email,
    csrf_token: csrf,
  });
}
export async function sessionAuth(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const raw =
    req.headers.cookie
      ?.split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith("unsta_session="))
      ?.slice(14) ?? "";
  if (!/^[a-f0-9]{64}$/.test(raw)) fail(401, "SESSION", "Iniciá sesión");
  const session = await db.session.findUnique({
    where: { tokenHash: digest(raw) },
  });
  if (!session || session.expiresAt < new Date())
    fail(401, "SESSION", "Sesión vencida");
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    checkOrigin(req);
    if (!equal(digest(req.get("x-csrf-token") ?? ""), session.csrfHash))
      fail(403, "CSRF", "Token de sesión inválido");
  }
  res.locals.actor = {
    workspaceId: session.workspaceId,
    email: session.email,
    sessionId: session.id,
  } satisfies Actor;
  next();
}
export function serviceAuth(req: Request, _res: Response, next: NextFunction) {
  if (
    !equal(
      digest(req.get("authorization") ?? ""),
      digest("Bearer " + config.AGENT_SERVICE_KEY),
    )
  )
    fail(401, "SERVICE_AUTH", "Credencial inválida");
  next();
}
export async function newInvite(email: string) {
  const secret = token();
  const workspace = await db.$transaction(async (tx) => {
    // Concurrent first invitations must share the workspace without a create race.
    await tx.workspace.createMany({
      data: [{ id: config.UNSTA_WORKSPACE_ID, name: "UNSTA" }],
      skipDuplicates: true,
    });
    const ws = await tx.workspace.findUniqueOrThrow({
      where: { id: config.UNSTA_WORKSPACE_ID },
    });
    await tx.invite.create({
      data: {
        workspaceId: ws.id,
        email,
        tokenHash: digest(secret),
        expiresAt: new Date(Date.now() + 86400000),
      },
    });
    return ws;
  });
  return { workspace, token: secret };
}
