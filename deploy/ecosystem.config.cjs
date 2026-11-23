// pm2 keeps the API and the workers running, restarts them if they stop, and starts them again after a reboot.
const path = require("node:path");
const root = path.resolve(__dirname, "..");

module.exports = {
  apps: [
    {
      name: "api",
      cwd: root,
      script: "node_modules/tsx/dist/cli.mjs",
      args: "apps/api/src/server.ts",
      // Supabase's pooler allows only a few connections at once; the API and the workers each use a small share.
      env: { NODE_ENV: "production", DB_POOL: "5" },
      max_restarts: 20,
    },
    {
      name: "workers",
      cwd: root,
      script: "worker.js",
      env: { NODE_ENV: "production", DB_POOL: "5" },
      max_restarts: 20,
    },
  ],
};
