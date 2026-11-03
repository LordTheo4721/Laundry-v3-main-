// Hostinger Node.js entry point.
// Hostinger runs `node <entry-file>`. This ESM shim registers tsx so the
// TypeScript server (server.ts) can be loaded directly.
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

try {
  await import("tsx/esm");
} catch (err) {
  console.error("[FATAL] tsx is not available at runtime. Run npm install and ensure tsx is installed.");
  throw err;
}

const serverTsPath = path.join(__dirname, "server.ts");
if (!fs.existsSync(serverTsPath)) {
  console.error("[FATAL] server.ts is missing from the deployment.");
  process.exit(1);
}

await import("./server.ts");