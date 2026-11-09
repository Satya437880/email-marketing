import { recordClick, recordOpen, unsubscribeByToken } from "@outreach/core";
import { escapeHtml } from "@outreach/mail";
import type { FastifyInstance } from "fastify";

const PIXEL = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
const TOKEN = /^[A-Za-z0-9_-]{10,64}$/;

function page(title: string, body: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<style>body{font-family:system-ui,sans-serif;background:#f6f7f9;color:#1f2937;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px}
.card{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:32px;max-width:420px;width:100%;text-align:center}
button{background:#1f2937;color:#fff;border:0;border-radius:8px;padding:10px 18px;font-size:15px;cursor:pointer}
p{color:#4b5563;line-height:1.5}</style></head><body><div class="card">${body}</div></body></html>`;
}

// Public endpoints that recipients hit. No session, no workspace in the path.
export async function trackingRoutes(app: FastifyInstance) {
  app.get("/t/o/:token", async (req, reply) => {
    const { token } = req.params as { token: string };
    if (TOKEN.test(token)) await recordOpen(token).catch((e) => req.log.warn(e));
    reply.header("cache-control", "no-store, max-age=0").type("image/gif");
    return PIXEL;
  });

  app.get("/t/c/:token", async (req, reply) => {
    const { token } = req.params as { token: string };
    const { u } = req.query as { u?: string };
    const target = TOKEN.test(token) && u ? await recordClick(token, u).catch(() => null) : null;
    if (!target) return reply.code(404).type("text/html").send(page("Link not found", "<h2>Link not found</h2>"));
    return reply.redirect(target, 302);
  });

  // GET only shows a confirmation so link scanners can't unsubscribe people by accident.
  app.get("/u/:token", async (req, reply) => {
    const { token } = req.params as { token: string };
    if (!TOKEN.test(token)) return reply.code(404).type("text/html").send(page("Not found", "<h2>Link not found</h2>"));
    reply.type("text/html");
    return page("Unsubscribe", `<h2>Unsubscribe</h2><p>Click below and you won't receive further emails from this sender.</p>
<form method="post"><button type="submit">Unsubscribe</button></form>`);
  });

  // Handles both the form above and RFC 8058 one-click (List-Unsubscribe-Post) requests.
  app.post("/u/:token", async (req, reply) => {
    const { token } = req.params as { token: string };
    const res = TOKEN.test(token) ? await unsubscribeByToken(token) : null;
    reply.type("text/html");
    if (!res) return reply.code(404).send(page("Not found", "<h2>Link not found</h2>"));
    return page("Unsubscribed", `<h2>You're unsubscribed</h2><p>${escapeHtml(res.email)} won't receive further emails from this sender.</p>`);
  });
}
