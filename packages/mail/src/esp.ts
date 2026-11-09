import { promises as dns } from "node:dns";

export type Esp = "google" | "microsoft" | "other" | "unknown";

export function espFromMx(exchanges: string[]): Esp {
  const all = exchanges.map((e) => e.toLowerCase());
  if (all.some((e) => e.endsWith("google.com") || e.endsWith("googlemail.com"))) return "google";
  if (all.some((e) => e.endsWith("outlook.com") || e.endsWith("protection.outlook.com") || e.endsWith("hotmail.com"))) return "microsoft";
  return all.length ? "other" : "unknown";
}

const cache = new Map<string, Esp>();

export async function detectEsp(email: string): Promise<Esp> {
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return "unknown";
  const hit = cache.get(domain);
  if (hit) return hit;
  let esp: Esp;
  try {
    const mx = await dns.resolveMx(domain);
    esp = espFromMx(mx.map((r) => r.exchange));
  } catch {
    esp = "unknown";
  }
  cache.set(domain, esp);
  return esp;
}

const deliverable = new Map<string, { ok: boolean; at: number }>();

// False only when DNS definitively says the domain can't receive mail (no such domain, or no MX and no A record).
// Lookup failures such as timeouts return true so a flaky resolver never blocks sending.
export async function domainAcceptsMail(email: string): Promise<boolean> {
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return false;
  const hit = deliverable.get(domain);
  if (hit && Date.now() - hit.at < 6 * 3600000) return hit.ok;
  const definite = (e: unknown) => ["ENOTFOUND", "ENODATA", "NXDOMAIN"].includes((e as { code?: string }).code ?? "");
  let ok = true;
  try {
    const mx = await dns.resolveMx(domain);
    ok = mx.some((r) => r.exchange && r.exchange !== ".");
  } catch (e) {
    if (definite(e)) {
      try {
        ok = (await dns.resolve4(domain)).length > 0;
      } catch (e2) {
        ok = !definite(e2);
      }
    }
  }
  deliverable.set(domain, { ok, at: Date.now() });
  return ok;
}

export interface DnsCheck {
  spf: boolean;
  dmarc: boolean;
  mx: boolean;
  dkim: boolean | null;
}

export async function checkDomainDns(domain: string, dkimSelectors = ["google", "selector1", "selector2", "default", "k1"]): Promise<DnsCheck> {
  const txt = async (name: string) => {
    try {
      return (await dns.resolveTxt(name)).map((r) => r.join(""));
    } catch {
      return [];
    }
  };
  const [root, dmarc, mx] = await Promise.all([txt(domain), txt(`_dmarc.${domain}`), dns.resolveMx(domain).catch(() => [])]);
  let dkim: boolean | null = null;
  for (const sel of dkimSelectors) {
    const recs = await txt(`${sel}._domainkey.${domain}`);
    if (recs.some((r) => r.includes("p="))) {
      dkim = true;
      break;
    }
  }
  return {
    spf: root.some((r) => r.toLowerCase().startsWith("v=spf1")),
    dmarc: dmarc.some((r) => r.toLowerCase().startsWith("v=dmarc1")),
    mx: mx.length > 0,
    dkim,
  };
}
