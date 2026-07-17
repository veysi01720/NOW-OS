#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

const root = process.cwd();
const composePath = resolve(root, "../docker-compose.yml");
const packagePath = resolve(root, "package.json");
const dockerfilePath = resolve(root, "Dockerfile");
const compose = readFileSync(composePath, "utf8");
const pkg = JSON.parse(readFileSync(packagePath, "utf8"));
const dockerfile = readFileSync(dockerfilePath, "utf8");

const reasons = [];
if (!root.endsWith("/now_os_backend")) reasons.push("WORKSPACE_IDENTITY_MISMATCH");
if (!compose.includes("now_os_backend:")) reasons.push("SERVICE_IDENTITY_MISMATCH");
if (!compose.includes("build: ./now_os_backend")) reasons.push("WRONG_WORKSPACE_IMAGE");
if (!compose.includes('"127.0.0.1:3000:3000"')) reasons.push("PORT_IDENTITY_MISMATCH");
if (pkg.scripts?.start !== "node dist/server.js") reasons.push("COMMAND_IDENTITY_MISMATCH");
if (!dockerfile.includes('CMD ["node", "dist/server.js"]')) reasons.push("COMMAND_IDENTITY_MISMATCH");

const sourceHash = createHash("sha256")
  .update(compose)
  .update(JSON.stringify(pkg.scripts ?? {}))
  .update(dockerfile)
  .digest("hex");

if (reasons.length > 0) {
  console.log(`DEPLOY_RUNTIME_LOCK=DENIED reason_codes=${JSON.stringify([...new Set(reasons)])}`);
  process.exit(1);
}

console.log(`DEPLOY_RUNTIME_LOCK=ALLOWED source_sha=${sourceHash}`);
