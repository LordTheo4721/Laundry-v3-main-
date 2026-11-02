// Hostinger Node.js entry point.
// Hostinger runs `node <entry-file>`. This ESM shim registers tsx so the
// TypeScript server (server.ts) can be loaded directly.
import 'tsx/esm';
await import('./server.ts');