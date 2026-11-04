// Hostinger Node.js entry point.
// Hostinger's loader calls require() on this file, so it must not use top-level
// await (Node throws ERR_REQUIRE_ASYNC_MODULE). Everything runs inside import()
// promises instead. This ESM shim registers tsx so server.ts can be loaded directly.
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

import("tsx/esm")
  .catch((err) => {
    console.error("[FATAL] tsx is not available at runtime. Run npm install and ensure tsx is installed.");
    throw err;
  })
  .then(() => {
    const serverTsPath = path.join(__dirname, "server.ts");
    if (!fs.existsSync(serverTsPath)) {
      console.error("[FATAL] server.ts is missing from the deployment.");
      process.exit(1);
    }
    return import("./server.ts");
  })
  .catch((err) => {
    console.error("[FATAL] Failed to load server.ts:", err);
    process.exit(1);
  });
