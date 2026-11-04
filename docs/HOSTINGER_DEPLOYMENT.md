# Hostinger Deployment Guide (Laundry v3)

This app is a Node.js/Express + Vite React SPA. Hostinger supports two
deployment styles. Pick the one that matches your plan.

## A. Shared hosting (Apache + PHP) — static frontend only

The backend (Express API + SQLite) cannot run on shared hosting. You can
only host the built frontend here, and the booking/admin features that need
the API will not work. For a fully working site use option B.

1. Build locally:
   ```bash
   npm install
   npm run build
   ```
2. Upload the **contents of `dist/`** (not the project root) to `public_html/`.
   - `dist/index.html`, `dist/.htaccess`, `dist/assets/*`.
   - Do NOT upload `src/`, `server.ts`, `node_modules/`.
3. File permissions: directories `755`, files `644`. Never `777`.
   ```bash
   find . -type d -exec chmod 755 {} \;
   find . -type f -exec chmod 644 {} \;
   ```
4. The included `.htaccess` handles SPA routing, HTTPS redirect, MIME types,
   caching and disables PHP error display.
5. DNS: point your domain's A record to Hostinger's IP and wait for
   propagation (up to 24h). Verify with `nslookup yourdomain.com`.
6. SSL: enable the free Let's Encrypt certificate in hPanel → SSL, then
   force HTTPS (already in `.htaccess`).

## B. Hostinger Cloud / Node.js hosting — full app

0. **Application root (critical):** In hPanel → Node.js → your app, set
   **Application root** to the folder that contains `package.json` (the project
   root). Do NOT point it at `build/`, `dist/`, `src/`, or `public/` — those
   folders have no `package.json`, which is exactly what causes the
   "package.json file not found" build failure. If you uploaded a zip of the
   repo, the root is the extracted folder (e.g. `laundry-v3-main`), not `/`.
1. Build & start commands (set in hPanel):
   - Build: `npm install && npm run build`
   - Start: `npm start` (runs `npx tsx server.ts`)
   - Entry file: `server.js` (Node.js shim that loads `server.ts` via tsx).
     If Hostinger accepts TypeScript entry files directly, `server.ts` also works.
2. Environment variables (hPanel → Environment):
   ```
   PORT=<provided by host, usually 8080>
   NODE_ENV=production
   JWT_SECRET=<openssl rand -base64 32>
   ADMIN_PASSWORD=<strong, >=12 chars>
   DB_NAME=laundry.db
   MACHINE_DEFAULT_TIME=2700
   ALLOWED_ORIGINS=https://yourdomain.com
   SMTP_HOST=...
   SMTP_PORT=587
   SMTP_USER=...
   SMTP_PASS=...
   SMTP_FROM=...
   EMAIL_DISABLED=false
   ```
3. The server throws at boot if `JWT_SECRET`/`ADMIN_PASSWORD` are missing or
   weak — check runtime logs for `Error: ADMIN_PASSWORD must be...`.
4. `better-sqlite3` is a native module; ensure the host runs `npm install`
   on Linux so it is rebuilt for the host platform.
5. SQLite file (`laundry.db`) is created on first boot. Use a persistent
   disk or migrate to MySQL for durable data.
6. Health check: `curl https://yourdomain.com/api/health`
   Expected: `{"success":true,"data":{"status":"ok","database":"connected"}}`.

## Blank page checklist

- Open DevTools → Console for red errors.
- Network tab: confirm `index.html` and `assets/index-*.js` return 200.
- If assets 404: you uploaded the source tree instead of `dist/`.
- If `Failed to fetch dynamically imported module`: hard refresh (Ctrl+Shift+R).
- If 502/blank with no assets: server crashed — check runtime logs for
  `ADMIN_PASSWORD`/`JWT_SECRET` errors or `Cannot find module 'better-sqlite3'`.
- DNS not propagated: site won't load at all (not a blank page).
- Mixed content (HTTP assets on HTTPS page): check Console for blocked requests.
- File permissions wrong: 403 on assets → blank page. Fix to 644/755.

## DNS & SSL quick checks

- `nslookup yourdomain.com` should return Hostinger's IP.
- `curl -I https://yourdomain.com` should return 200 with valid cert.
- Browser padlock must show; if "Not secure", enable Let's Encrypt in hPanel.