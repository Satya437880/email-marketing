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
      env: { NODE_ENV: "production" },
      max_restarts: 20,
    },
    {
      name: "workers",
      cwd: root,
      script: "worker.js",
      env: { NODE_ENV: "production" },
      max_restarts: 20,
    },
  ],
};
