# 503 Service Unavailable — "Server Temporarily Busy" Runbook

This runbook diagnoses and restores availability for the Laundry v3 Node.js/Express
application when clients receive `503 Service Unavailable` (often surfaced by a
reverse proxy/load balancer as "server temporarily busy"). It is ordered by
impact and safety. **Do not delete or modify production data while following it.**

## 0. Safety rules

- Take a backup before any change:
  ```bash
  npm run backup
  # or copy the SQLite file
  cp laundry.db "laundry.db.$(date +%Y%m%d%H%M%S).bak"
  ```
- Prefer read-only diagnostics first. Restart only after capturing logs.
- Never run `DROP`, `DELETE`, or schema migrations during an incident unless a
  documented rollback exists.
- Keep `/api/health` reachable; it is the probe used by Railway/Hostinger.

## 1. Immediate triage (0-5 minutes)

1. Confirm the symptom and scope:
   ```bash
   curl -i https://<host>/api/health
   curl -i https://<host>/
   ```
   - `503` from `/api/health` with `Database unavailable` → database problem (§4).
   - `503` only on browser/API routes while `/api/health` is `200` → proxy, rate
     limit, or maintenance mode (§3, §5, §7).
   - `502/504` instead of `503` → process crash or timeout (§2, §6).

2. Check whether maintenance mode was accidentally enabled:
   ```bash
   # hosting dashboard / shell
   echo "MAINTENANCE_MODE=$MAINTENANCE_MODE"
   ```
   - If `true`, set `MAINTENANCE_MODE=false` and restart (§9). The app now keeps
     `/api/health` available even in maintenance mode.

3. Capture current resource usage:
   ```bash
   # Linux host / container
   top -b -n1 | head -20
   free -h
   df -h
   ps aux --sort=-%cpu | head -20
   ```
   - CPU sustained > 80% or memory > 90% → §2.

## 2. High CPU or memory usage

Checks:
```bash
# Node process
ps -o pid,ppid,%cpu,%mem,rss,cmd -C node
# Event-loop lag (if node process is reachable)
node -e "const s=Date.now(); setTimeout(()=>console.log('lag ms:', Date.now()-s-1000),1000)"
```

Likely causes in this app:
- The 1-second machine timer in `server.ts` runs a heavy transactional query.
- MySQL access uses synchronous `deasync`, which blocks the event loop under load.
- Large report/export endpoints (`SalesReports`, Excel export) can spike CPU.

Actions:
- Restart the Node process to clear a stuck event loop:
  ```bash
  # systemd
  sudo systemctl restart laundry
  # PM2
  pm2 restart laundry --update-env
  # Railway/Hostinger: trigger redeploy or restart from dashboard
  ```
- Temporarily disable expensive admin exports if a report is running.
- Increase instance size or move to a plan with more CPU/RAM.
- Verify no runaway process:
  ```bash
  ps aux | grep -E "tsx|node" | grep -v grep
  ```

Verification:
```bash
curl -s https://<host>/api/health | jq .
# expect status ok and heap_used_bytes not growing between calls
```

## 3. Exhausted worker processes / single-process limits

This app runs as a single Node process (`npm start` → `npx tsx server.ts`).
There is no cluster/worker pool in the application.

Checks:
```bash
# How many node processes are listening?
ss -ltnp | grep :${PORT:-8080}
# Connection count
ss -tn | grep :${PORT:-8080} | wc -l
```

Actions:
- If the host allows multiple instances, run behind a process manager with
  clustering (PM2 `cluster` mode) or scale horizontally.
- Ensure graceful shutdown is not stuck:
  ```bash
  # send SIGTERM and watch logs
  kill -TERM <pid>
  ```
- Avoid long-running synchronous work in request handlers; move heavy exports to
  background jobs.

Verification:
```bash
curl -s -o /dev/null -w "%{http_code}\n" https://<host>/api/health
```

## 4. Database connection limits

### SQLite (default)
Checks:
```bash
ls -lh laundry.db
# integrity check (read-only)
sqlite3 laundry.db "PRAGMA integrity_check;"
```
- A locked/corrupt SQLite file or a long-running write transaction can make every
  request wait.

Actions:
- Ensure only one Node process uses the SQLite file.
- Restore from backup if `integrity_check` is not `ok`:
  ```bash
  cp laundry.db laundry.db.corrupt.$(date +%s)
  cp laundry.db.<timestamp>.bak laundry.db
  ```

### MySQL (when DB_ENGINE=mysql)
Checks:
```sql
SHOW PROCESSLIST;
SHOW STATUS LIKE 'Threads_connected';
SHOW VARIABLES LIKE 'max_connections';
```
- If `Threads_connected` is near `max_connections`, the pool is exhausted.

Actions:
- Increase MySQL `max_connections` (requires DBA approval) and/or app pool size:
  ```env
  DB_POOL_SIZE=20
  DB_QUEUE_LIMIT=200
  DB_CONNECT_TIMEOUT=10000
  ```
- The app now uses a finite queue (`DB_QUEUE_LIMIT`, default 100) instead of an
  unbounded queue, so excess requests fail fast instead of hanging the event loop.
- Verify no long-running queries:
  ```sql
  SELECT * FROM information_schema.PROCESSLIST WHERE TIME > 30;
  ```

Verification:
```bash
curl -s https://<host>/api/health
# database must be "connected"
```

## 5. Reverse proxy / load balancer misconfiguration

Checks:
```bash
# Headers seen by the app
curl -s https://<host>/api/health -D -
# DNS
nslookup <host>
# TLS
curl -I https://<host>
```

Common issues:
- `trust proxy` not set behind a proxy → all clients share one IP → rate limiter
  blocks everyone. The app sets `trust proxy` in production and supports
  `TRUST_PROXY=<hops>` or `TRUST_PROXY=true`.
- Health check path not configured → platform marks instance unhealthy → 503.
  Railway uses `/api/health` (see `railway.json`).
- Proxy timeout shorter than slow endpoints → 504/503.

Actions:
- Set `TRUST_PROXY` to the number of proxy hops in front of the app.
- Confirm the platform health check path is `/api/health` and timeout ≥ 30s.
- For Hostinger/Apache static hosting, remember the backend cannot run there; only
  the built frontend can be served (see `docs/HOSTINGER_DEPLOYMENT.md`).

Verification:
```bash
curl -s https://<host>/api/health
```

## 6. Rate limiting

The app uses three limiters:
- `loginRateLimiter`: default 10 / 15 min
- `apiRateLimiter`: default 1000 / min
- `publicRateLimiter`: default 120 / 15 min

Checks:
```bash
# Look for 429/503 in logs
grep -E "429|Too many" server.out
# Response headers
curl -i https://<host>/api/reviews/public | grep -i ratelimit
```

Actions:
- If legitimate traffic is being limited, raise limits via env:
  ```env
  API_RATE_LIMIT_MAX=2000
  PUBLIC_RATE_LIMIT_MAX=300
  LOGIN_RATE_LIMIT_MAX=20
  ```
- If a single IP is flooding, block it at the proxy/firewall instead of lowering
  app limits.

Verification:
```bash
# Repeated health checks should stay 200
for i in $(seq 1 20); do curl -s -o /dev/null -w "%{http_code}\n" https://<host>/api/health; done
```

## 7. Deployment issues

Checks:
```bash
npm run lint
npm run build
ls -lh dist/index.html dist/assets | head
```

Common issues:
- Missing/weak `JWT_SECRET` or `ADMIN_PASSWORD` → process exits at boot → 502/503.
- `better-sqlite3` native module not built for host platform.
- `dist/` missing on host → static assets 404.

Actions:
- Set all required env vars (see `docs/HOSTINGER_DEPLOYMENT.md` §B).
- Ensure build command runs on host: `npm install && npm run build`.
- Redeploy after fixing env vars.

Verification:
```bash
curl -s https://<host>/api/health
curl -s https://<host>/api/pricing/public | head -c 200
```

## 8. Maintenance mode

Checks:
```bash
echo "MAINTENANCE_MODE=$MAINTENANCE_MODE"
curl -i https://<host>/api/health
```

Actions:
- Disable maintenance mode:
  ```env
  MAINTENANCE_MODE=false
  ```
- Restart the service.
- The app returns `503` with `Retry-After: 120` for non-health routes while
  maintenance mode is enabled, so probes can still pass.

Verification:
```bash
curl -s -o /dev/null -w "%{http_code}\n" https://<host>/
# expect 200 after disabling
```

## 9. Safe restore procedure (no data loss)

1. Stop traffic (enable maintenance mode or remove instance from load balancer).
2. Back up the database.
3. Apply the smallest config change (env var or restart).
4. Run health check and smoke tests.
5. Re-enable traffic gradually.
6. Monitor for 15 minutes:
   ```bash
   # watch error rate
   tail -f server.out | grep -E "503|500|ERROR|FATAL"
   ```

## 10. Verification checklist

- [ ] `/api/health` returns `200` with `database: connected`.
- [ ] `/api/pricing/public` returns pricing rows.
- [ ] Home page loads without console errors.
- [ ] No `503`/`500`/`FATAL` in logs for 15 minutes.
- [ ] CPU < 70% and memory < 80% at steady state.
- [ ] DB connections below 80% of `max_connections`.
- [ ] Rate-limit headers present and not exhausted for normal traffic.

## 11. Code changes made for this incident

- `server.ts`: configurable rate limits, configurable trust proxy, controlled
  maintenance mode, enriched `/api/health` with memory/uptime.
- `src/db/mysql.ts`: finite connection queue, connect timeout, keep-alive.
- `src/db/config.ts`: `DB_QUEUE_LIMIT`, `DB_CONNECT_TIMEOUT` env support.
- `docs/503_SERVICE_UNAVAILABLE.md`: this runbook.
