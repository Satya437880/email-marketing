// Starts the background workers (sending emails, reading replies). Run it with:  node worker.js
//
// The app is written in TypeScript. This file turns on the TypeScript loader (tsx) and then starts apps/workers/src/index.ts,
// so a host that wants a plain "node worker.js" start command can use it. Settings come from the .env file in this folder
// (or from real environment variables on a server): DATABASE_URL, REDIS_URL and CREDENTIALS_KEY must be set.
import { register } from "tsx/esm/api";

register();

await import("./apps/workers/src/index.ts");
