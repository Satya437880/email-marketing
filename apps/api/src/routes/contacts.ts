import { addContactsToSequence, emailDomain } from "@outreach/core";
import { companies, contacts, contactTags, db, importJobs, sequenceContacts, sequences, tags } from "@outreach/db";
import { detectEsp } from "@outreach/mail";
import { parse as parseCsv } from "csv-parse/sync";
import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { wsId } from "../auth";
import { body, HttpError, idParams, notFound, params, query } from "../http";

const FREE_MAIL = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "outlook.com", "hotmail.com", "live.com", "msn.com", "icloud.com", "me.com",
  "aol.com", "proton.me", "protonmail.com", "gmx.com", "gmx.de", "yandex.com", "zoho.com", "mail.com", "ymail.com",
]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const STANDARD_FIELDS = ["email", "first_name", "last_name", "title", "company_name", "linkedin_url"] as const;
type StandardField = (typeof STANDARD_FIELDS)[number];

export interface ContactInput {
  email: string;
  first_name?: string;
  last_name?: string;
  title?: string;
  company_name?: string;
  linkedin_url?: string;
  variables?: Record<string, string>;
}

async function companyIds(workspaceId: string, rows: ContactInput[]) {
  const map = new Map<string, string>();
  const byDomain = new Map<string, string>();
  for (const r of rows) {
    const d = emailDomain(r.email);
    if (d && !FREE_MAIL.has(d) && !byDomain.has(d)) byDomain.set(d, r.company_name ?? "");
  }
  if (!byDomain.size) return map;
  const inserted = await db.insert(companies)
    .values([...byDomain].map(([domain, name]) => ({ workspaceId, domain, name: name || null })))
    .onConflictDoUpdate({ target: [companies.workspaceId, companies.domain], set: { domain: sql`excluded.domain` } })
    .returning({ id: companies.id, domain: companies.domain });
  for (const c of inserted) map.set(c.domain, c.id);
  return map;
}

async function espByDomain(domainsList: string[]) {
  const out = new Map<string, string>();
  const queue = [...new Set(domainsList)];
  await Promise.all(Array.from({ length: 16 }, async () => {
    for (let d = queue.pop(); d; d = queue.pop()) out.set(d, await detectEsp(`x@${d}`));
  }));
  return out;
}

export async function upsertContacts(workspaceId: string, rows: ContactInput[], tagId?: string | null) {
  let inserted = 0;
  let updated = 0;
  const ids: string[] = [];
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const comp = await companyIds(workspaceId, chunk);
    const esp = await espByDomain(chunk.map((r) => emailDomain(r.email)));
    const result = await db.insert(contacts).values(chunk.map((r) => ({
      workspaceId,
      email: r.email,
      firstName: r.first_name ?? "",
      lastName: r.last_name ?? "",
      title: r.title ?? "",
      companyName: r.company_name ?? "",
      linkedinUrl: r.linkedin_url ?? "",
      variables: r.variables ?? {},
      companyId: comp.get(emailDomain(r.email)) ?? null,
      esp: esp.get(emailDomain(r.email)) ?? "unknown",
    }))).onConflictDoUpdate({
      target: [contacts.workspaceId, contacts.email],
      set: {
        firstName: sql`coalesce(nullif(excluded.first_name, ''), ${contacts.firstName})`,
        lastName: sql`coalesce(nullif(excluded.last_name, ''), ${contacts.lastName})`,
        title: sql`coalesce(nullif(excluded.title, ''), ${contacts.title})`,
        companyName: sql`coalesce(nullif(excluded.company_name, ''), ${contacts.companyName})`,
        linkedinUrl: sql`coalesce(nullif(excluded.linkedin_url, ''), ${contacts.linkedinUrl})`,
        variables: sql`${contacts.variables} || excluded.variables`,
      },
    }).returning({ id: contacts.id, isNew: sql<boolean>`(xmax = 0)` });
    for (const r of result) {
      ids.push(r.id);
      if (r.isNew) inserted++;
      else updated++;
    }
    if (tagId && result.length) {
      await db.insert(contactTags).values(result.map((r) => ({ contactId: r.id, tagId }))).onConflictDoNothing();
    }
  }
  return { inserted, updated, ids };
}

function normaliseRow(raw: Record<string, string>, mapping: Record<string, string>): ContactInput | { error: string } {
  const out: ContactInput = { email: "", variables: {} };
  for (const [column, target] of Object.entries(mapping)) {
    const value = (raw[column] ?? "").trim();
    if (!target || target === "skip") continue;
    if ((STANDARD_FIELDS as readonly string[]).includes(target)) (out as unknown as Record<string, string>)[target as StandardField] = value;
    else if (value) out.variables![target.trim().toLowerCase().replace(/[\s-]+/g, "_")] = value;
  }
  out.email = out.email.toLowerCase();
  if (!EMAIL_RE.test(out.email)) return { error: `Invalid email "${out.email}"` };
  return out;
}

// The Filters panel on the Contacts page. Each filter is "include" (only these) or "exclude" (not these).
const filterMode = z.enum(["include", "exclude"]);
const listFilter = z.object({ mode: filterMode, values: z.array(z.string().max(300)).max(300) });
const panelFilters = z.object({
  lastContacted: z.object({ mode: filterMode, days: z.number().int().min(0).max(36500) }).optional(),
  tag: listFilter.optional(),
  esp: listFilter.optional(),
  validation: listFilter.optional(),
  sequence: listFilter.optional(),
  company: listFilter.optional(),
  customVar: z.object({ mode: filterMode, name: z.string().max(100), op: z.enum(["contains", "equals", "starts", "empty", "not_empty"]), value: z.string().max(300).optional() }).optional(),
  excludeContacted: z.boolean().optional(),
});
type PanelFilters = z.infer<typeof panelFilters>;

function parsePanelFilters(raw?: string): PanelFilters {
  if (!raw) return {};
  try {
    const r = panelFilters.safeParse(JSON.parse(raw));
    if (r.success) return r.data;
  } catch { /* fall through */ }
  throw new HttpError(400, "bad_filters", "The filters could not be read");
}

const uuidList = (values: string[]) => values.filter((v) => /^[0-9a-f-]{36}$/i.test(v));
const likeEscape = (v: string) => v.replace(/[\\%_]/g, (c) => `\\${c}`);

function panelConditions(f: PanelFilters): SQL[] {
  const out: SQL[] = [];
  const maybeNot = (mode: "include" | "exclude", cond: SQL) => (mode === "exclude" ? sql`not (${cond})` : cond);
  if (f.lastContacted) out.push(maybeNot(f.lastContacted.mode, sql`(${contacts.lastContactedAt} is not null and ${contacts.lastContactedAt} <= now() - (${f.lastContacted.days} * interval '1 day'))`));
  if (f.tag?.values.length) {
    const ids = uuidList(f.tag.values);
    out.push(maybeNot(f.tag.mode, ids.length ? sql`exists (select 1 from ${contactTags} ct where ct.contact_id = ${contacts.id} and ct.tag_id in (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)}))` : sql`false`));
  }
  if (f.sequence?.values.length) {
    const ids = uuidList(f.sequence.values);
    out.push(maybeNot(f.sequence.mode, ids.length ? sql`exists (select 1 from ${sequenceContacts} sc where sc.contact_id = ${contacts.id} and sc.sequence_id in (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)}))` : sql`false`));
  }
  if (f.esp?.values.length) out.push(maybeNot(f.esp.mode, inArray(contacts.esp, f.esp.values)));
  if (f.validation?.values.length) out.push(maybeNot(f.validation.mode, inArray(contacts.validationStatus, f.validation.values)));
  if (f.company?.values.length) out.push(maybeNot(f.company.mode, sql`lower(${contacts.companyName}) in (${sql.join(f.company.values.map((v) => sql`${v.toLowerCase()}`), sql`, `)})`));
  if (f.customVar?.name.trim()) {
    const key = f.customVar.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    const val = f.customVar.value?.trim() ?? "";
    const col = sql`(${contacts.variables} ->> ${key})`;
    const op = f.customVar.op;
    if (op === "empty") out.push(maybeNot(f.customVar.mode, sql`coalesce(${col}, '') = ''`));
    else if (op === "not_empty") out.push(maybeNot(f.customVar.mode, sql`coalesce(${col}, '') <> ''`));
    else if (val) {
      const cond = op === "equals" ? sql`lower(${col}) = ${val.toLowerCase()}` : op === "starts" ? sql`${col} ilike ${`${likeEscape(val)}%`}` : sql`${col} ilike ${`%${likeEscape(val)}%`}`;
      out.push(maybeNot(f.customVar.mode, cond));
    }
  }
  if (f.excludeContacted) out.push(sql`${contacts.lastContactedAt} is null`);
  return out;
}

function contactFilters(workspaceId: string, q: { q?: string; tagId?: string; sequenceId?: string; esp?: string; validation?: string; filters?: string }) {
  const parts: (SQL | undefined)[] = [eq(contacts.workspaceId, workspaceId)];
  if (q.q) {
    const like = `%${q.q}%`;
    parts.push(or(ilike(contacts.email, like), ilike(contacts.firstName, like), ilike(contacts.lastName, like), ilike(contacts.companyName, like)));
  }
  if (q.tagId) parts.push(sql`exists (select 1 from ${contactTags} ct where ct.contact_id = ${contacts.id} and ct.tag_id = ${q.tagId})`);
  if (q.sequenceId) parts.push(sql`exists (select 1 from ${sequenceContacts} sc where sc.contact_id = ${contacts.id} and sc.sequence_id = ${q.sequenceId})`);
  if (q.esp) parts.push(eq(contacts.esp, q.esp));
  if (q.validation) parts.push(eq(contacts.validationStatus, q.validation));
  parts.push(...panelConditions(parsePanelFilters(q.filters)));
  return and(...parts);
}

const listQuery = z.object({
  q: z.string().trim().optional(),
  tagId: z.string().uuid().optional(),
  sequenceId: z.string().uuid().optional(),
  esp: z.string().optional(),
  validation: z.string().optional(),
  filters: z.string().max(20000).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export async function contactRoutes(app: FastifyInstance) {
  // Choices for the Filters panel: company names, and the names of the custom variables contacts have.
  app.get("/v1/workspaces/:ws/contacts/filter-options", async (req) => {
    const q = query(req, z.object({ kind: z.enum(["company", "variable"]), q: z.string().trim().max(100).optional() }));
    const workspaceId = wsId(req);
    if (q.kind === "company") {
      const like = `%${likeEscape(q.q ?? "")}%`;
      const rows = await db.execute<{ name: string; n: number }>(sql`
        select company_name as name, count(*)::int as n from contacts
        where workspace_id = ${workspaceId} and company_name <> '' and company_name ilike ${like}
        group by company_name order by n desc, company_name limit 50`) as unknown as { name: string; n: number }[];
      return rows;
    }
    const rows = await db.execute<{ name: string; n: number }>(sql`
      select k as name, count(*)::int as n from contacts c, jsonb_object_keys(c.variables) k
      where c.workspace_id = ${workspaceId} group by k order by n desc, k limit 100`) as unknown as { name: string; n: number }[];
    return rows;
  });

  app.get("/v1/workspaces/:ws/contacts", async (req) => {
    const q = query(req, listQuery);
    const where = contactFilters(wsId(req), q);
    const [rows, [count]] = await Promise.all([
      db.select().from(contacts).where(where).orderBy(desc(contacts.createdAt), asc(contacts.email)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
      db.select({ n: sql<number>`count(*)::int` }).from(contacts).where(where),
    ]);
    const tagRows = rows.length
      ? await db.select({ contactId: contactTags.contactId, id: tags.id, name: tags.name }).from(contactTags)
        .innerJoin(tags, eq(tags.id, contactTags.tagId)).where(inArray(contactTags.contactId, rows.map((r) => r.id)))
      : [];
    return {
      items: rows.map((r) => ({ ...r, tags: tagRows.filter((t) => t.contactId === r.id).map(({ id, name }) => ({ id, name })) })),
      total: count?.n ?? 0,
    };
  });

  app.post("/v1/workspaces/:ws/contacts", async (req) => {
    const b = body(req, z.object({
      email: z.string().trim().toLowerCase().email(),
      first_name: z.string().trim().max(100).optional(),
      last_name: z.string().trim().max(100).optional(),
      title: z.string().trim().max(200).optional(),
      company_name: z.string().trim().max(200).optional(),
      linkedin_url: z.string().trim().max(500).optional(),
      variables: z.record(z.string().max(1000)).optional(),
      tagId: z.string().uuid().optional(),
      tags: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
    }));
    const { tagId, tags: tagNames, ...input } = b;
    const workspaceId = wsId(req);
    if (input.variables) {
      input.variables = Object.fromEntries(Object.entries(input.variables)
        .map(([k, v]) => [k.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""), v.trim()] as const)
        .filter(([k, v]) => k && v));
    }
    const r = await upsertContacts(workspaceId, [input], tagId);
    const contactId = r.ids[0]!;
    if (tagNames?.length) {
      const unique = [...new Set(tagNames)];
      await db.insert(tags).values(unique.map((name) => ({ workspaceId, name }))).onConflictDoNothing();
      const rows = await db.select({ id: tags.id }).from(tags).where(and(eq(tags.workspaceId, workspaceId), inArray(tags.name, unique)));
      if (rows.length) await db.insert(contactTags).values(rows.map((t) => ({ contactId, tagId: t.id }))).onConflictDoNothing();
    }
    return db.query.contacts.findFirst({ where: eq(contacts.id, contactId) });
  });

  // One contact with its tags and the sequences it is in (for the details panel).
  app.get("/v1/workspaces/:ws/contacts/:id", async (req) => {
    const p = params(req, idParams);
    const row = await db.query.contacts.findFirst({ where: and(eq(contacts.id, p.id), eq(contacts.workspaceId, wsId(req))) });
    if (!row) notFound("Contact");
    const tagRows = await db.select({ id: tags.id, name: tags.name }).from(contactTags).innerJoin(tags, eq(tags.id, contactTags.tagId)).where(eq(contactTags.contactId, row.id));
    const seqRows = await db.select({ id: sequences.id, name: sequences.name, status: sequences.status, state: sequenceContacts.state })
      .from(sequenceContacts).innerJoin(sequences, eq(sequences.id, sequenceContacts.sequenceId)).where(eq(sequenceContacts.contactId, row.id));
    return { ...row, tags: tagRows, sequences: seqRows };
  });

  app.patch("/v1/workspaces/:ws/contacts/:id", async (req) => {
    const p = params(req, idParams);
    const b = body(req, z.object({
      firstName: z.string().trim().max(100).optional(),
      lastName: z.string().trim().max(100).optional(),
      title: z.string().trim().max(200).optional(),
      companyName: z.string().trim().max(200).optional(),
      linkedinUrl: z.string().trim().max(500).optional(),
      variables: z.record(z.string()).optional(),
    }));
    const [row] = await db.update(contacts).set(b).where(and(eq(contacts.id, p.id), eq(contacts.workspaceId, wsId(req)))).returning();
    if (!row) notFound("Contact");
    return row;
  });

  // Parses a CSV and returns its headers and a few rows so the UI can show the column-mapping step.
  app.post("/v1/workspaces/:ws/imports/preview", async (req) => {
    const b = body(req, z.object({ csv: z.string().min(1) }));
    const records = parseCsv(b.csv, { columns: true, skip_empty_lines: true, bom: true, relax_column_count: true, to: 6 }) as Record<string, string>[];
    const headers = records[0] ? Object.keys(records[0]) : [];
    const guess = Object.fromEntries(headers.map((h) => {
      const k = h.toLowerCase().replace(/[^a-z]/g, "");
      const target =
        k.includes("email") ? "email"
        : ["firstname", "first", "fname", "givenname"].includes(k) ? "first_name"
        : ["lastname", "last", "lname", "surname", "familyname"].includes(k) ? "last_name"
        : ["title", "jobtitle", "position", "role"].includes(k) ? "title"
        : ["company", "companyname", "organization", "organisation", "account"].includes(k) ? "company_name"
        : k.includes("linkedin") ? "linkedin_url"
        : h;
      return [h, target];
    }));
    return { headers, sample: records.slice(0, 5), mapping: guess };
  });

  // Only the sheet ID is taken from the user's URL; the request always goes to Google's CSV export, never to an arbitrary host.
  app.post("/v1/workspaces/:ws/imports/google-sheet", async (req) => {
    const b = body(req, z.object({ url: z.string().trim().min(10).max(2000) }));
    const id = b.url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,})/)?.[1];
    if (!id) throw new HttpError(400, "invalid_sheet_url", "That doesn't look like a Google Sheets link");
    const gid = b.url.match(/[#&?]gid=(\d+)/)?.[1] ?? "0";
    const res = await fetch(`https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`, { redirect: "follow" });
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || type.includes("text/html")) {
      throw new HttpError(400, "sheet_not_public", "Couldn't read the sheet. In Google Sheets, click Share → General access → “Anyone with the link” (Viewer), then try again.");
    }
    const csv = await res.text();
    if (csv.length > 20_000_000) throw new HttpError(400, "sheet_too_large", "The sheet is too large to import at once");
    return { csv };
  });

  app.post("/v1/workspaces/:ws/imports", async (req) => {
    const b = body(req, z.object({
      csv: z.string().min(1),
      mapping: z.record(z.string()),
      tagId: z.string().uuid().optional(),
      newTag: z.string().trim().min(1).max(60).optional(),
      sequenceId: z.string().uuid().optional(),
      source: z.enum(["csv", "google_sheet"]).default("csv"),
    }));
    if (b.sequenceId) {
      const seq = await db.query.sequences.findFirst({ where: and(eq(sequences.id, b.sequenceId), eq(sequences.workspaceId, wsId(req))) });
      if (!seq) notFound("Sequence");
    }
    if (!Object.values(b.mapping).includes("email")) throw new HttpError(400, "email_column_required", "Map one column to Email");
    const workspaceId = wsId(req);
    let tagId = b.tagId ?? null;
    if (b.newTag) {
      const [t] = await db.insert(tags).values({ workspaceId, name: b.newTag })
        .onConflictDoUpdate({ target: [tags.workspaceId, tags.name], set: { name: b.newTag } }).returning();
      tagId = t!.id;
    }
    const [job] = await db.insert(importJobs).values({ workspaceId, source: b.source, status: "running" }).returning();

    void (async () => {
      const errors: { row: number; error: string }[] = [];
      try {
        const records = parseCsv(b.csv, { columns: true, skip_empty_lines: true, bom: true, relax_column_count: true }) as Record<string, string>[];
        const valid: ContactInput[] = [];
        const seen = new Set<string>();
        records.forEach((raw, i) => {
          const r = normaliseRow(raw, b.mapping);
          if ("error" in r) errors.push({ row: i + 2, error: r.error });
          else if (seen.has(r.email)) errors.push({ row: i + 2, error: `Duplicate of an earlier row (${r.email})` });
          else {
            seen.add(r.email);
            valid.push(r);
          }
        });
        await db.update(importJobs).set({ total: records.length }).where(eq(importJobs.id, job!.id));
        const res = await upsertContacts(workspaceId, valid, tagId);
        if (b.sequenceId) await addContactsToSequence(workspaceId, b.sequenceId, res.ids);
        await db.update(importJobs).set({
          status: "done", inserted: res.inserted, updated: res.updated, skipped: errors.length, errors: errors.slice(0, 200), finishedAt: new Date(),
        }).where(eq(importJobs.id, job!.id));
      } catch (e) {
        await db.update(importJobs).set({ status: "failed", errors: [...errors.slice(0, 199), { row: 0, error: (e as Error).message }], finishedAt: new Date() })
          .where(eq(importJobs.id, job!.id));
      }
    })();
    return job;
  });

  app.get("/v1/workspaces/:ws/imports/:id", async (req) => {
    const p = params(req, idParams);
    const job = await db.query.importJobs.findFirst({ where: and(eq(importJobs.id, p.id), eq(importJobs.workspaceId, wsId(req))) });
    if (!job) notFound("Import");
    return job;
  });

  app.post("/v1/workspaces/:ws/contacts/bulk", async (req) => {
    const b = body(req, z.object({
      action: z.enum(["tag", "untag", "delete", "add_to_sequence"]),
      ids: z.array(z.string().uuid()).optional(),
      filter: listQuery.omit({ page: true, pageSize: true }).optional(),
      tagId: z.string().uuid().optional(),
      sequenceId: z.string().uuid().optional(),
    }));
    const workspaceId = wsId(req);
    const where = b.ids ? and(eq(contacts.workspaceId, workspaceId), inArray(contacts.id, b.ids)) : contactFilters(workspaceId, b.filter ?? {});
    const target = (await db.select({ id: contacts.id }).from(contacts).where(where)).map((r) => r.id);
    if (!target.length) return { affected: 0 };

    if (b.action === "delete") {
      await db.delete(contacts).where(and(eq(contacts.workspaceId, workspaceId), inArray(contacts.id, target)));
      return { affected: target.length };
    }
    if (b.action === "tag" || b.action === "untag") {
      if (!b.tagId) throw new HttpError(400, "tag_required", "Choose a tag");
      const tag = await db.query.tags.findFirst({ where: and(eq(tags.id, b.tagId), eq(tags.workspaceId, workspaceId)) });
      if (!tag) notFound("Tag");
      for (let i = 0; i < target.length; i += 1000) {
        const chunk = target.slice(i, i + 1000);
        if (b.action === "tag") await db.insert(contactTags).values(chunk.map((contactId) => ({ contactId, tagId: tag.id }))).onConflictDoNothing();
        else await db.delete(contactTags).where(and(eq(contactTags.tagId, tag.id), inArray(contactTags.contactId, chunk)));
      }
      return { affected: target.length };
    }
    if (!b.sequenceId) throw new HttpError(400, "sequence_required", "Choose a sequence");
    const added = await addContactsToSequence(workspaceId, b.sequenceId, target);
    return { affected: added, alreadyIn: target.length - added };
  });

  // Tags
  app.get("/v1/workspaces/:ws/tags", async (req) => {
    const workspaceId = wsId(req);
    const rows = await db.select({
      id: tags.id, name: tags.name, createdAt: tags.createdAt,
      contacts: sql<number>`(select count(*)::int from ${contactTags} ct where ct.tag_id = ${tags.id})`,
    }).from(tags).where(eq(tags.workspaceId, workspaceId)).orderBy(asc(tags.name));
    const usage = rows.length ? await db.execute<{ tag_id: string; sequence_id: string; name: string; total: number; done: number }>(sql`
      select ct.tag_id, s.id as sequence_id, s.name, count(*)::int as total,
             count(*) filter (where sc.state not in ('queued', 'active', 'sending', 'ooo'))::int as done
      from ${contactTags} ct
      join ${sequenceContacts} sc on sc.contact_id = ct.contact_id
      join ${sequences} s on s.id = sc.sequence_id
      where s.workspace_id = ${workspaceId}
      group by ct.tag_id, s.id, s.name
    `) as unknown as { tag_id: string; sequence_id: string; name: string; total: number; done: number }[] : [];
    return rows.map((t) => ({
      ...t,
      sequences: usage.filter((u) => u.tag_id === t.id).map((u) => ({ id: u.sequence_id, name: u.name, progress: u.total ? Math.round((u.done / u.total) * 100) : 0 })),
    }));
  });

  app.post("/v1/workspaces/:ws/tags", async (req) => {
    const b = body(req, z.object({ name: z.string().trim().min(1).max(60) }));
    const [row] = await db.insert(tags).values({ workspaceId: wsId(req), name: b.name }).onConflictDoNothing().returning();
    if (!row) throw new HttpError(409, "tag_exists", "A tag with this name already exists");
    return row;
  });

  app.delete("/v1/workspaces/:ws/tags/:id", async (req) => {
    const p = params(req, idParams);
    await db.delete(tags).where(and(eq(tags.id, p.id), eq(tags.workspaceId, wsId(req))));
    return { ok: true };
  });
}
