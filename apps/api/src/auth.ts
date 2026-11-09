import { createHash, randomBytes } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";
import { apiKeys, db, memberships, sessions, users, workspaces } from "@outreach/db";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";
import { HttpError } from "./http";

export const SESSION_COOKIE = "sid";
const SESSION_DAYS = 30;

export type Role = "owner" | "admin" | "member" | "viewer" | "primebox";

// "Primebox Only" users may read and answer replies and nothing else in the workspace.
const PRIMEBOX_PATHS = /^\/v1\/workspaces\/[^/]+\/(threads|labels|templates|reminders)(\/|\?|$)/;

declare module "fastify" {
  interface FastifyRequest {
    user?: typeof users.$inferSelect;
    workspace?: typeof workspaces.$inferSelect;
    apiKeyWorkspace?: typeof workspaces.$inferSelect;
    role?: Role;
  }
}

export const hashPassword = (pw: string) => hash(pw, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
export const verifyPassword = (h: string, pw: string) => verify(h, pw).catch(() => false);

export async function createSession(reply: FastifyReply, userId: string): Promise<void> {
  const id = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400000);
  await db.insert(sessions).values({ id, userId, expiresAt });
  reply.setCookie(SESSION_COOKIE, id, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    expires: expiresAt,
  });
}

export async function destroySession(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const id = req.cookies[SESSION_COOKIE];
  if (id) await db.delete(sessions).where(eq(sessions.id, id));
  reply.clearCookie(SESSION_COOKIE, { path: "/" });
}

export async function loadUser(req: FastifyRequest): Promise<void> {
  const id = req.cookies[SESSION_COOKIE];
  if (!id) return;
  const [row] = await db.select({ user: users }).from(sessions).innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, new Date())));
  if (row) req.user = row.user;
}

export function requireUser(req: FastifyRequest) {
  if (!req.user) throw new HttpError(401, "unauthorized", "Please log in");
  return req.user;
}

export const API_KEY_PREFIX = "mpk_";
export const hashApiKey = (key: string) => createHash("sha256").update(key).digest("hex");

// Bearer API keys act as an admin of exactly one workspace.
export async function loadApiKey(req: FastifyRequest): Promise<boolean> {
  const header = req.headers.authorization ?? "";
  const key = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!key.startsWith(API_KEY_PREFIX)) return false;
  const [row] = await db.select({ key: apiKeys, ws: workspaces }).from(apiKeys)
    .innerJoin(workspaces, eq(workspaces.id, apiKeys.workspaceId))
    .where(and(eq(apiKeys.keyHash, hashApiKey(key)), isNull(apiKeys.revokedAt)));
  if (!row) throw new HttpError(401, "invalid_api_key", "API key is invalid or revoked");
  req.apiKeyWorkspace = row.ws;
  await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, row.key.id));
  return true;
}

// Resolves :ws (workspace slug) and the caller's role. Viewers are read-only.
export async function loadWorkspace(req: FastifyRequest): Promise<void> {
  const slug = (req.params as { ws?: string }).ws;
  if (!slug) return;
  if (req.apiKeyWorkspace) {
    if (req.apiKeyWorkspace.slug !== slug) throw new HttpError(404, "not_found", "Workspace not found");
    req.workspace = req.apiKeyWorkspace;
    req.role = "admin";
    return;
  }
  const user = requireUser(req);
  const [row] = await db.select({ ws: workspaces, role: memberships.role }).from(workspaces)
    .innerJoin(memberships, and(eq(memberships.workspaceId, workspaces.id), eq(memberships.userId, user.id)))
    .where(eq(workspaces.slug, slug));
  if (!row) throw new HttpError(404, "not_found", "Workspace not found");
  req.workspace = row.ws;
  req.role = row.role;
  if (row.role === "viewer" && req.method !== "GET") throw new HttpError(403, "forbidden", "Viewers have read-only access");
  if (row.role === "primebox") {
    const ok = PRIMEBOX_PATHS.test(req.url) && !(req.url.includes("/labels") && req.method !== "GET");
    if (!ok) throw new HttpError(403, "forbidden", "Your role only has access to Primebox");
  }
}

export function requireRole(req: FastifyRequest, ...roles: Role[]) {
  if (!req.role || !roles.includes(req.role)) throw new HttpError(403, "forbidden", "You don't have permission for this action");
}

export function wsId(req: FastifyRequest): string {
  if (!req.workspace) throw new HttpError(404, "not_found", "Workspace not found");
  return req.workspace.id;
}
