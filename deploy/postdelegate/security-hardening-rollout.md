# Rolling out the security hardening

Audit findings A2, A3, A5, A7, A9, A10 (the 7 Nov audit; A1 is its own branch
and runbook). Everything here ships with the next release.

## Server step needed BEFORE the release, or Compose will not start

Two changes in `compose.yaml` need a server step first. Compose refusing to
start is deliberate: the alternative is a default that quietly brings back the
thing being fixed.

1. **Redis now requires a password.** Add to `/etc/postiz/runtime.env`:

   ```bash
   printf 'POSTIZ_REDIS_PASSWORD=%s\n' "$(openssl rand -base64 36 | tr -d '/+=' | cut -c1-40)" >> /etc/postiz/runtime.env
   ```

   It has no default on purpose: a fallback would quietly bring back the open
   Redis this fixes. `docker compose config` fails loudly if it is missing.
   Redis holds queue state and cache and was reachable from every container on
   the network.

2. **`no-new-privileges` on every service, and `cap_drop: ALL` on Redis.**
   Postgres, Temporal and Caddy keep their capabilities: their entrypoints need
   chown/setuid and Caddy needs `NET_BIND_SERVICE` for 80/443, so dropping
   everything breaks them. Worth revisiting per-service later.

Also in this train, needing no server step: the Caddyfile gains `base-uri`,
`object-src` and a `Permissions-Policy`. Remember that a Caddy config change
needs the **container restarted**, not reloaded — a reload is a no-op here.

## Needing no server step

- **Sign out of all devices** (A2). `User.sessionVersion` is new, so the schema
  change arrives with `prisma db push` as usual. No index, no backfill: every
  user starts at 0, and a session issued before this release carries no version
  claim and is read as 0, so the deploy signs nobody out.
- **The tenant boundary is now compiler-enforced** (A3), with a guard spec over
  all 93 route handlers that take a resource id. No runtime change.
- **bcrypt cost 12** for new hashes (A10). Existing hashes keep their own cost
  and upgrade when the password next changes.
- **Sentry 10.78.0** (A6), clearing the one critical advisory. The pinned
  release image carries 10.56.0 and this repo's install goes over it — check the
  built image resolves 10.78.0, as was needed for @aws-sdk/client-sesv2.

## What to click through on staging

1. Sign in, then Settings → Sign out of all devices: it signs you out, and a
   second browser that was signed in is signed out too.
2. Sign in again on both: both work (the version moved for both).
3. Change a password: the other session is signed out, as before.
4. Open the public preview link of a post while signed out: it still renders.
5. Post to any channel: the queue still works, which is what proves Redis
   authentication is wired (the app cannot reach Redis without it).
6. `curl -sI https://staging.postdelegate.com | grep -i -E 'permissions-policy|content-security'`
   shows the new headers. Remember Caddy needs the container **restarted**, not
   reloaded.

## Host housekeeping done on 7 Nov (audit D2), and one landmine found

- The 17 `Caddyfile.*` backups in `/opt/postiz` moved to
  `/opt/postiz/caddyfile-history/`, so only the live `Caddyfile` sits beside
  the compose file. Nothing was deleted.
- `/opt/postdelegate` (an earlier deployment layout, nothing running from it)
  now carries a `SUPERSEDED.md` saying so. Kept rather than removed.
- **The 8 pending apt updates are not security updates.** Four are Docker CE
  and four are `noble-updates`; `unattended-upgrades` is configured for
  `noble` and `noble-security` only, so it is working as designed. Upgrading
  `docker-ce` restarts every container, so it belongs in a planned window, not
  a security fix.
- **Landmine, now documented at `/opt/postiz/VOLUME-WARNING.md`:** the live
  TLS private keys and certificates for app, staging and both rerun hosts live
  in the Docker volume `postdelegate-prod_caddy_data` — named after a Compose
  project that **no longer exists**. The running project is
  `postdelegate-postiz`. So `docker compose -p postdelegate-prod down -v`, or
  any tidy-up of "the old prod project", deletes them; and `docker volume
  prune` is safe only while the caddy container is running, since that is what
  keeps the volume from being dangling. Recoverable (Caddy re-issues) but with
  rate limits and no TLS in the meantime.

---

## Released to production, 7 Nov 2026

Done in this order, each step verified before the next:

1. Backup taken first: `/var/backups/postiz/20261107T105159Z`.
2. `prisma migrate diff` read before anything ran. It wanted exactly three
   statements and nothing else, so no drift had accumulated.
3. Those applied by hand, the index **concurrently**, so writes to
   `Organization` were never blocked — the container runs `prisma db push` on
   every start and would otherwise have taken a SHARE lock:
   `ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "apiKeyHash" TEXT;`
   `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "sessionVersion" INTEGER NOT NULL DEFAULT 0;`
   `CREATE INDEX CONCURRENTLY IF NOT EXISTS "Organization_apiKeyHash_idx" ON "Organization"("apiKeyHash");`
4. `POSTIZ_REDIS_PASSWORD` was already in `/etc/postiz/runtime.env`.
5. New `Caddyfile` and `compose.yaml` installed, old ones kept in
   `caddyfile-history/` and `compose.yaml.before-hardening-*`.
6. **`/etc/postiz/caddy.env` created** (0600 root) with
   `STAGING_BASIC_AUTH_USER` and `STAGING_BASIC_AUTH_HASH`, recovered from the
   previous live Caddyfile, and the caddy service given that `env_file`. The
   committed Caddyfile keeps those as `{$PLACEHOLDER}`s; without the env file
   Caddy expands them to empty strings, **still reports a valid config**, and
   staging's gate silently stops working. This was caught before restarting.
7. `postiz-compose up -d`, then `--force-recreate caddy`: Compose does not
   recreate caddy for a bind-mounted file change, and a Caddy *reload* is a
   no-op here, so the new headers need the container recreated.
8. Backfill: dry run read first (4 organization rows to convert, nothing
   unreadable), then the real run — 4 updated, 0 unreadable, 0 skipped.

Verified after: app healthy on `release-8b798dcf`; Redis answers `WRONGPASS`
unauthenticated and `PONG` with credentials, runs as uid 999 with all
capabilities dropped, 0 restarts, 0 app errors; the new CSP and
`Permissions-Policy` live on `app.postdelegate.com`; staging still 401s
unauthenticated; `/api/docs` still 404; **an API key issued before the
migration still authenticates (200) and a bogus one is refused (401)**; and the
§4 verification query returns 0 for every column.

Note the rollback window (§6) is now closed: every organization row holds
`enc:v1:…`. The pre-release backup above is the way back.

## 7 Nov: the caddy env file, continued

Two further faults in the same area, both found while releasing `00497382` and
both fixed on the server before this was committed.

**The bcrypt hash needs its `$` doubled.** Compose interpolates `env_file`
values, so `$2b$12$…` arrived in the container as 28 characters instead of 60.
`basic_auth` then matched nothing and `staging.postdelegate.com` answered 401 to
the correct password. That reads exactly like a wrong credential, which is how
it cost an hour: the password was checked against the hash on disk, found to
match, and the fault was still in front of it. `/etc/postiz/caddy.env` now
writes the hash with every `$` as `$$`. To check:

```
sudo docker exec postdelegate-postiz-caddy-1 sh -c 'echo ${#STAGING_BASIC_AUTH_HASH}'   # 60
```

**Caddy was on the staging network only by hand.** It reverse-proxies
`staging.postdelegate.com` to a container in the separate staging project, and
that attachment had been made with `docker network connect`, not in Compose. The
`--force-recreate caddy` needed to pick up the env file dropped it, and every
staging page became a 502 that nothing but the Caddy log explained. `compose.yaml`
now declares the staging network as `external` and puts caddy on it, and
`compose.spec.ts` fails if either goes away.

Both of these fail in a way that points at the wrong thing — a credential, or the
staging app — rather than at Caddy. Check the length and the networks first.
