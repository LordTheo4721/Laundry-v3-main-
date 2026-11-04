// Hostinger Node.js entry point.
// The server is compiled into server.bundle.mjs by the build step (npm run build),
// so the host runs plain JavaScript and never loads TypeScript at runtime.
import("./server.bundle.mjs").catch((err) => {
  console.error("[FATAL] Server failed to start:", err);
  process.exit(1);
});
