import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as schema from "./schema";

const envFile = fileURLToPath(new URL("../../../.env", import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

export * from "./schema";
export * from "./crypto";
export { schema };

const url = process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/outreach";

export const sqlClient = postgres(url, { max: Number(process.env.DB_POOL ?? 10) });
export const db = drizzle(sqlClient, { schema });
export type Db = typeof db;
