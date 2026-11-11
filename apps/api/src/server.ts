import "@outreach/db";
import cookie from "@fastify/cookie";
import { envOAuthCreds } from "@outreach/core";
import cors from "@fastify/cors";
import Fastify from "fastify";
import { loadApiKey, loadUser, loadWorkspace } from "./auth";
import { HttpError } from "./http";
import { analyticsRoutes } from "./routes/analytics";
import { authRoutes } from "./routes/auth";
import { contactRoutes } from "./routes/contacts";
import { inboxRoutes } from "./routes/inbox";
import { mailboxRoutes } from "./routes/mailboxes";
import { oauthLoginRoutes } from "./routes/oauth-login";
import { sequenceRoutes } from "./routes/sequences";
import { trackingRoutes } from "./routes/tracking";
import { workspaceRoutes } from "./routes/workspace";

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" }, bodyLimit: 50 * 1024 * 1024, trustProxy: true });

await app.register(cookie, { secret: process.env.SESSION_SECRET });
await app.register(cors, { origin: process.env.WEB_ORIGIN ?? "http://localhost:5173", credentials: true });

// One-click unsubscribe posts arrive as form data.
app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_req, b, done) => done(null, b));

app.addHook("onRequest", async (req) => {
  if (!req.url.startsWith("/v1/")) return;
  // API keys are sent explicitly, not by the browser, so they don't need the CSRF header.
  if (await loadApiKey(req)) return;
  // CSRF: browsers can't send this header cross-site without passing CORS.
  if (req.method !== "GET" && req.method !== "HEAD" && req.headers["x-requested-with"] !== "outreach") {
    throw new HttpError(403, "csrf", "Missing X-Requested-With header");
  }
  await loadUser(req);
});

app.addHook("preHandler", async (req) => {
  if (req.url.startsWith("/v1/workspaces/") && (req.params as { ws?: string }).ws) await loadWorkspace(req);
});

app.setErrorHandler((err: Error, req, reply) => {
  if (err instanceof HttpError) {
    return reply.code(err.status).send({ code: err.code, message: err.message, details: err.details });
  }
  const status = (err as { statusCode?: number }).statusCode;
  if (status && status < 500) return reply.code(status).send({ code: "bad_request", message: err.message });
  req.log.error(err);
  return reply.code(500).send({ code: "internal", message: "Something went wrong" });
});

app.get("/health", async () => ({ ok: true }));
await app.register(authRoutes);
await app.register(oauthLoginRoutes);
await app.register(workspaceRoutes);
await app.register(mailboxRoutes);
await app.register(contactRoutes);
await app.register(sequenceRoutes);
await app.register(inboxRoutes);
await app.register(analyticsRoutes);
await app.register(trackingRoutes);

// Owner-facing: tell whoever runs the server which sign-in providers are not configured.
const PROVIDER_ENV = { google: ["Google", "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET"], microsoft: ["Microsoft", "MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET"] } as const;
for (const p of ["google", "microsoft"] as const) {
  if (!envOAuthCreds(p)) app.log.warn(`${PROVIDER_ENV[p][0]} login and mailbox connection are disabled. Set ${PROVIDER_ENV[p][1]} in .env and restart the API.`);
}

await app.listen({ port: Number(process.env.API_PORT ?? 4000), host: "0.0.0.0" });
