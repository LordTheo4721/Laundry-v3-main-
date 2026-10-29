# Blank White Page — Troubleshooting Guide (Laundry v3)

This guide diagnoses why the site renders a blank white page and gives
step-by-step checks/fixes across frontend, backend/API, hosting, browser/cache,
and server logs.

## 0. Quick triage (do these first)

1. Open the site in an **incognito/private window** (rules out cache/extensions).
2. Open DevTools → **Console** (F12 / Ctrl+Shift+J). Look for red errors.
3. Open DevTools → **Network** tab, reload (Ctrl+R), filter by `JS`/`Doc`.
   - Is `index.html` 200? Is the main bundle `assets/index-*.js` 200?
   - Any 404/500 on assets or `/api/*`?
4. Check the hosting provider's **deploy logs** and **runtime logs** for crashes.

If the console shows a React error, jump to §1. If assets 404, jump to §3.
If the server never responds, jump to §2/§4.

---

## 1. Frontend code

### 1.1 Inspect console errors
- DevTools → Console. Common blank-page causes:
  - `Cannot read properties of null (reading 'render')` → `#root` missing in `index.html`.
  - `Failed to fetch dynamically imported module` → stale chunk after redeploy (cache issue, §5).
  - Uncaught exception in a component → React unmounts the tree. The app has an
    `ErrorBoundary` (`src/components/ErrorBoundary.tsx`) that should show a fallback;
    if even that is blank, the error happened before React mounted (check `src/main.tsx`).
- Fix: read the stack trace, open the file/line, fix the null access / bad import.

### 1.2 Verify entry points
- `index.html` must contain `<div id="root"></div>` and
  `<script type="module" src="/src/main.tsx"></script>` (dev) — production build
  rewrites this to `/assets/index-*.js`.
- `src/main.tsx` calls `createRoot(document.getElementById('root')!).render(...)`.
  If `#root` is absent, the non-null assertion throws → blank page.
- Run `npm run lint` (`tsc --noEmit`) to catch type errors that may break the build.

### 1.3 Build output
- Run locally:
  ```bash
  npm run build
  ```
  - Must print `✓ built in ...` and create `dist/index.html` + `dist/assets/*`.
  - If it fails, fix the reported module resolution / syntax error first.
  - Inspect `dist/index.html`: the script `src` must point to an existing file in
    `dist/assets/`.
- Preview the production build:
  ```bash
  npm run preview
  ```
  Open the printed URL; if it's blank here too, the bug is in frontend code, not hosting.

### 1.4 Environment variables (frontend)
- This app uses relative `/api` calls, so no `VITE_*` vars are required.
- `process.env.GEMINI_API_KEY` is injected at build time via `vite.config.ts`
  (`define`). If a component references it and it's undefined, guard with `?? ''`.

---

## 2. Backend / API

### 2.1 Server startup (most common production cause)
`server.ts` throws at boot if required env vars are missing/weak:
- `JWT_SECRET` must be ≥32 chars and not a placeholder.
- `ADMIN_PASSWORD` must be ≥12 chars and not a placeholder.
If these are unset on the host, the process exits → hosting returns 502/blank.

Check runtime logs for:
```
Error: ADMIN_PASSWORD must be a strong password ...
Error: JWT_SECRET must be a strong secret ...
```
Fix: set the env vars in the hosting dashboard (see §4).

### 2.2 Health check
```bash
curl https://<your-host>/api/health
```
Expected: `{"success":true,"data":{"status":"ok","database":"connected"}}`.
- If it fails/times out, the server is down or the DB can't open.
- `better-sqlite3` is a native module; it must be installed/built for the host's
  platform (Linux on Render). Ensure the build runs `npm install` on the host.

### 2.3 API responses
- DevTools → Network → filter `Fetch/XHR`. Click a failing request:
  - Status 401/403 → auth/cookie issue (admin routes).
  - Status 404 → route not registered or wrong base path.
  - Status 500 → server error; check server logs for `[Global Error]`.
- The frontend's `extractData` (`src/utils/api.ts`) throws on empty/invalid JSON;
  a 502 HTML page from the host will surface as "Server returned an invalid response".

### 2.4 CORS / cookies
- `allowedOrigins` in `server.ts` must include your production origin.
- Admin auth uses httpOnly cookies with `credentials: 'include'`; the frontend
  sends `credentials: 'include'`. If the API origin differs, cookies won't attach.

### 2.5 Price calculation verification
- Verify pricing endpoint:
  ```bash
  curl https://<host>/api/pricing/public
  ```
- The frontend uses `src/utils/sharedPricing.ts` (`calculatePrice`,
  `calculateGrandTotal`) as the single source of truth, shared with the backend.
- If prices look wrong, compare the DB rows (admin Pricing page) against the
  returned JSON and the `FALLBACK_PRICING` in `src/utils/pricing.ts`.

---

## 3. Hosting / deployment

### 3.1 Build & start commands
- Build: `npm install && npm run build`
- Start: `npm start` (runs `npx tsx server.ts`)
- `railway.json` already defines these. For Render, set them in the dashboard.

### 3.2 NODE_ENV
- The server treats `NODE_ENV !== "production"` as dev mode (Vite middleware).
- On hosts where `NODE_ENV` is unset, the app now defaults to **production**
  serving (fixed in this repo). Set `NODE_ENV=production` explicitly to be safe.

### 3.3 Required environment variables (set in hosting dashboard)
```
PORT=<provided by host>
NODE_ENV=production
JWT_SECRET=<openssl rand -base64 32>
ADMIN_PASSWORD=<strong, >=12 chars>
DB_NAME=laundry.db
MACHINE_DEFAULT_TIME=2700
SMTP_HOST=...
SMTP_PORT=587
SMTP_USER=...
SMTP_PASS=...
SMTP_FROM=...
EMAIL_DISABLED=false
```
Never commit `.env` (it's gitignored). Use the host's secret manager.

### 3.4 Static assets / SPA fallback
- Production serves `dist/` via `express.static` and falls back to
  `dist/index.html` for non-API routes. If `dist/` is missing, assets 404 → blank.
- Ensure the build step runs before start and that `dist/` is not gitignored-then-missing
  (it's gitignored, so it must be built on the host).

### 3.5 Database persistence
- SQLite file (`laundry.db`) is created on first boot. On ephemeral hosts (Render
  free tier), the DB resets on redeploy. Use a persistent disk or migrate to Postgres
  for production data.

---

## 4. Server logs

### 4.1 Local
```bash
npm run dev
```
Watch stdout for `[DB]`, Vite errors, and the startup banner. The banner now prints
`NODE_ENV`.

### 4.2 Production (Render)
- Dashboard → Service → **Logs**. Look for:
  - `EADDRINUSE` → port conflict (use host-provided PORT).
  - `Cannot find module 'better-sqlite3'` → native module not built.
  - Unhandled promise rejection → `startServer()` failure (now logged as `[FATAL]`).

### 4.3 Add request logging
- `morgan("short")` is already enabled. For deeper debugging, temporarily set
  `morgan("combined")` or add `console.log(req.method, req.path, res.statusCode)`.

---

## 5. Browser / cache

### 5.1 Hard refresh
- Chrome/Edge: Ctrl+Shift+R (Windows) / Cmd+Shift+R (Mac).
- Firefox: Ctrl+F5.

### 5.2 Clear site data
- DevTools → Application → Storage → **Clear site data** (cookies, cache, localStorage).
- Or DevTools → Network → check **Disable cache** while DevTools is open.

### 5.3 Stale chunks after redeploy
- Symptom: `Failed to fetch dynamically imported module` / blank page after a deploy.
- Cause: browser cached old `index.html` referencing old chunk hashes.
- Fix: hard refresh; ensure the host sends `Cache-Control: no-store` for `index.html`
  (this app sets it). Verify in Network tab → `index.html` → Response Headers.

### 5.4 Extensions / ad blockers
- Disable extensions (or test incognito) — some block scripts/fonts.

### 5.5 Service workers
- DevTools → Application → Service Workers → Unregister any stale worker, then reload.

---

## 6. Verification checklist

- [ ] `npm run lint` passes (no type errors).
- [ ] `npm run build` succeeds and `dist/index.html` exists.
- [ ] `npm run preview` renders the home page (not blank).
- [ ] `/api/health` returns ok.
- [ ] `/api/pricing/public` returns pricing rows.
- [ ] Browser console has no red errors on a fresh load.
- [ ] Network tab: `index.html` and main bundle are 200.
- [ ] Hosting logs show the startup banner with correct NODE_ENV.
- [ ] All required env vars are set in the hosting dashboard.

---

## 7. Files changed in this fix

- `server.ts`: default to production serving when `NODE_ENV` is unset; log NODE_ENV
  in the startup banner; wrap `startServer()` in `.catch()` for clear fatal logging.
- `TROUBLESHOOTING.md`: this guide.
