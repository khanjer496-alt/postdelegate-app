# Staging: https://staging.postdelegate.com

Staging is a full, separate copy of PostDelegate on the production VPS. Click a release through here before production gets it. It runs the same release image as production, with its own databases, Redis, Temporal, storage and secrets. It has no social provider keys, no billing and no email, so it cannot post to anyone's accounts, charge cards or email real users.

## Layout

| What | Where |
| --- | --- |
| Compose project | `postdelegate-staging`, file `/opt/postiz-staging/compose.yaml` (source: [staging/compose.yaml](staging/compose.yaml)) |
| Containers | `postdelegate-staging-{app,app-db,app-redis,temporal-server,temporal-db}-1` |
| Network | `postdelegate-staging` (production's Caddy is also attached; no other production container is) |
| Volumes | `postdelegate-staging_{app-config,app-uploads,app-db-data,app-redis-data,temporal-db-data}` |
| Configuration | `/etc/postiz/staging.env`, root 0600, created by [staging/initialize-staging.py](staging/initialize-staging.py) |
| Access logins | `/etc/postiz/staging-access`, root 0600: the basic-auth login and the QA test account. The owner's Mac keeps a 0600 copy in `.staging-access` (git-ignored). |
| Wrappers | `/usr/local/bin/postiz-staging-compose`, `/usr/local/bin/postiz-staging-release` (source: [staging/](staging/)) |
| Frontend URL fix | `/opt/postiz-staging/frontend-url.sh` (see "Why frontend-url.sh") |

No host ports are published. The shared production Caddy proxies `staging.postdelegate.com` to `postdelegate-staging-app-1:5000` over the staging network.

Staging service names are deliberately different from production's (`postiz`, `postgres`, `redis`, `temporal`, `temporal-postgresql`). Caddy sits on both networks, and Docker DNS answers from every network a container is attached to. If staging had a service called `postiz`, Caddy could send production traffic to it. Never add a staging service that shares a name with a production one.

Memory limits: app 2.5 GB, Temporal 512 MB, both PostgreSQL databases 384 MB each, Redis 256 MB. When idle, staging uses about 1.7 GB.

## Release to staging

Build the image as usual ([BUILD.md](BUILD.md)) and tag it `postdelegate-postiz:release-<rev>`. Then:

```sh
sudo postiz-staging-release release-<rev>
```

The script:

1. Checks that the image exists on the server.
2. Saves the current env to `/etc/postiz/staging.env.previous` and sets `POSTIZ_IMAGE`.
3. Recreates only the staging `app` container, then waits up to 10 minutes for the Docker healthcheck.
4. Checks that the container runs the requested image, that the orchestrator's `/health/status` passes, and that a worker is polling Temporal's `main` task queue.

If the app doesn't become healthy, the script prints the log command and the command to switch back (`sudo postiz-staging-release <previous tag>`). Production is never touched. When staging passes the click-through, release the same tag to production the usual way.

Other commands:

```sh
sudo postiz-staging-compose ps
sudo postiz-staging-compose logs --tail 200 app
sudo postiz-staging-compose restart app
sudo postiz-staging-compose stop                         # free memory; data volumes stay
sudo postiz-staging-compose up -d --wait                 # start again
```

To reset staging to an empty database, stop it and remove only the `postdelegate-staging_*` volumes. Check every name before you remove anything, and never run `down -v` or a prune with the production wrapper.

## Why frontend-url.sh

The release Dockerfile sets `NEXT_PUBLIC_BACKEND_URL=https://app.postdelegate.com/api` before the frontend build. Next.js inlines that value into the frontend's server bundle, where the layouts hand `backendUrl` to the browser. An unpatched staging frontend would therefore send logins and API calls to production.

`frontend-url.sh` runs before the image's normal command (`nginx && pnpm run pm2`):

1. It rewrites the baked URL to the container's own `NEXT_PUBLIC_BACKEND_URL`, inside the container's writable layer. The image itself is unchanged.
2. If any copy remains, it refuses to start.
3. Otherwise it `exec`s the image's command.

The app log shows `frontend-url: frontend backend URL set to https://staging.postdelegate.com/api` on every start.

A cleaner long-term fix is to stop setting `NEXT_PUBLIC_BACKEND_URL` at image build time, so the value is read at runtime. If that happens, the script finds nothing to replace and becomes a no-op.

## What is switched off, and what that means

`initialize-staging.py` builds `staging.env` from production's variable names, with staging values. It generates new JWT, token-encryption and database secrets. The only values it copies from production are the non-secret `HIDDEN_PROVIDERS`, `DCR_VERIFIED_DOMAINS` and `API_LIMIT`. `PREVIEW_PROVIDER_ORGS` is not copied, because staging has its own organization ids: set it by hand to let a staging workspace connect the hidden providers.

| Area | Staging setting | Effect |
| --- | --- | --- |
| URLs | `MAIN_URL`, `FRONTEND_URL` = `https://staging.postdelegate.com`; `NEXT_PUBLIC_BACKEND_URL` = `.../api` | Production does not set `BACKEND_URL`, so staging doesn't either. |
| Social providers | Every client ID and secret is absent, including `TELEGRAM_TOKEN` | You can't connect channels, so nothing is published. A shared Telegram bot token would also take updates away from production. |
| Billing | Stripe **test mode** only (`sk_test_`/`pk_test_`), see "Stripe test mode" below | Checkout, the billing portal, trials, plan limits and webhooks run against Stripe test mode with test cards. Without the keys, billing is off and every organization is treated as fully paid (`ULTIMATE`). |
| Email | No `EMAIL_PROVIDER` or `RESEND_API_KEY` | No mail is sent. LOCAL signups are activated immediately. Password reset, invitations, digests and notification emails can't be tested here. |
| Email cron jobs | `WEEKLY_SUMMARY_DISABLED`, `TRIAL_ONBOARDING_EMAILS_DISABLED`, `ANALYTICS_REPORTS_DISABLED` = `true` | A second safety layer on top of having no email provider. |
| Cron | `RUN_CRON=true` | The missing-post, weekly-summary and trial-onboarding workflows run, as in production. With no channels and no email provider, they do nothing external. |
| Storage | `STORAGE_PROVIDER=local` on the `app-uploads` volume | Uploads are served from `https://staging.postdelegate.com/uploads/...`. Production's R2 bucket is not used, and `r2.env` is not loaded. |
| AI | No AI keys | AI features need a bring-your-own key, as in production. |
| Registration | `DISABLE_REGISTRATION=false`, the same as production | Anyone who has the basic-auth login can sign up. |

## Access protection and the API/MCP exemptions

The Caddy block for staging, in `/opt/postiz/Caddyfile`, works like this:

- It keeps the same Cloudflare-only `@direct` origin filter as `app.postdelegate.com`.
- It adds `X-Robots-Tag: noindex, nofollow` to every proxied response.
- Everything else sits behind `basic_auth`.

The public API and MCP clients send their own `Authorization` header: an API key, or an OAuth or Bearer token. Basic auth needs that same header, so the two can't be combined. The following paths therefore skip basic auth and rely on the app's own API-key or OAuth auth:

- `/api/public/*`: the public API v1, plus public approval and review links
- `/api/mcp*`: `/api/mcp`, `/api/mcp/<key>` and `/api/mcp-oauth*`
- `/api/sse/*`, `/api/message/*`: the legacy MCP transport
- `/api/.well-known/*`, and the root `/.well-known/oauth-{protected-resource,authorization-server}/mcp-oauth-dynamic`, `/mcp-oauth-dynamic*`, `/.well-known/oauth-protected-resource/api/mcp`, `/.well-known/mcp.json`, `/.well-known/mcp/server-card.json` and `/.well-known/openai-apps-challenge` (rewritten to `/api`, as in production)
- `/api/oauth/register`, `/api/oauth/token`, `/api/oauth/userinfo`: the machine-to-machine OAuth endpoints MCP clients call

On the protected paths, Caddy removes the basic-auth `Authorization` header before proxying, so the app never sees it. The browser's OAuth consent page (`/oauth/authorize`) stays protected, so connecting an MCP client from Claude or ChatGPT asks for the basic-auth login once in the browser.

The block, with secrets replaced by placeholders:

```caddyfile
staging.postdelegate.com {
    encode zstd gzip
    header {
        -Server
        -X-Powered-By
        X-Content-Type-Options nosniff
        Referrer-Policy strict-origin-when-cross-origin
        Strict-Transport-Security "max-age=31536000"
        X-Frame-Options SAMEORIGIN
        Content-Security-Policy "frame-ancestors 'self'"
        X-Robots-Tag "noindex, nofollow"
    }
    @direct not remote_ip <same Cloudflare ranges as app.postdelegate.com>
    handle @direct {
        abort
    }
    @swagger path /api/docs /api/docs/* /api/docs-json /api/docs-yaml
    handle @swagger {
        respond 404
    }
    @machine path /api/public/* /api/mcp* /api/sse/* /api/message/* /api/.well-known/* /api/oauth/register /api/oauth/token /api/oauth/userinfo
    handle @machine {
        reverse_proxy postdelegate-staging-app-1:5000
    }
    @mcpOauth path /mcp-oauth-dynamic /mcp-oauth-dynamic/* /.well-known/oauth-protected-resource/mcp-oauth-dynamic /.well-known/oauth-authorization-server/mcp-oauth-dynamic
    handle @mcpOauth {
        rewrite * /api{uri}
        reverse_proxy postdelegate-staging-app-1:5000
    }
    @mcpWellKnown path /.well-known/oauth-protected-resource/api/mcp /.well-known/mcp.json /.well-known/mcp/server-card.json /.well-known/openai-apps-challenge
    handle @mcpWellKnown {
        rewrite * /api{uri}
        reverse_proxy postdelegate-staging-app-1:5000
    }
    handle {
        basic_auth {
            <user from /etc/postiz/staging-access> <bcrypt hash from `caddy hash-password`>
        }
        reverse_proxy postdelegate-staging-app-1:5000 {
            header_up -Authorization
        }
    }
}
```

To rotate the basic-auth password:

1. Update `/etc/postiz/staging-access`.
2. Hash the new password by piping it into `docker exec -i postdelegate-postiz-caddy-1 caddy hash-password`. Don't pass it with `--plaintext`.
3. Back up the Caddyfile, put the new hash in it, then write the file through its existing inode (`cat new > /opt/postiz/Caddyfile`).
4. Run `caddy validate`, then `caddy reload`, inside the Caddy container.

## Production changes made for staging (1 November 2026)

Only the shared Caddy was changed. The production postiz, PostgreSQL, Redis and Temporal containers, their volumes and `/etc/postiz/runtime.env` were not touched.

1. Backups: `/opt/postiz/Caddyfile.before-staging-20261101T164446Z` and `/opt/postiz/compose.yaml.before-staging-20261101T164446Z`.
2. `docker network connect postdelegate-staging postdelegate-postiz-caddy-1`. The Caddy container was not restarted. Afterwards, `postiz` still resolved only to the production app.
3. In `/opt/postiz/compose.yaml`, the `caddy` service gained `networks: [default, postdelegate-staging]`, and a top-level `networks: postdelegate-staging: external: true` was added, so a future recreate keeps the attachment. Because Caddy's Compose config changed, the next `postiz-compose --profile edge up -d` that includes `caddy` will recreate it once, a few seconds of edge downtime. `postiz-compose up -d postiz` doesn't recreate Caddy.
4. The staging site block was appended to `/opt/postiz/Caddyfile` through its existing inode. It was checked with `caddy validate` and applied with `caddy reload`. `https://app.postdelegate.com/auth/login` returned 200 straight after.

While Caddy references the network, don't remove it: `postiz-compose` would refuse to recreate Caddy.

To roll back:

```sh
sudo sh -c 'cat /opt/postiz/Caddyfile.before-staging-20261101T164446Z > /opt/postiz/Caddyfile'
sudo docker exec -w /etc/caddy postdelegate-postiz-caddy-1 caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
sudo cp /opt/postiz/compose.yaml.before-staging-20261101T164446Z /opt/postiz/compose.yaml
sudo docker network disconnect postdelegate-staging postdelegate-postiz-caddy-1
sudo postiz-staging-compose down            # keeps staging volumes; add nothing else
```

## DNS and TLS

`staging.postdelegate.com` needs a proxied (orange-cloud) Cloudflare DNS record pointing at the VPS, the same as `app.postdelegate.com`. Caddy obtains the Let's Encrypt certificate through HTTP-01 once the name resolves, and retries automatically until then. To retry immediately after adding the record, run the `caddy reload` command above with `--force`.

## Test account

One LOCAL QA account was created through the app's own `/api/auth/register` path. It was activated at once (no email provider), with the `SUPERADMIN` role and `ULTIMATE` tier because billing is off. Its email and password are only in `/etc/postiz/staging-access` and the owner's local `.staging-access`.

## Verify

```sh
sudo postiz-staging-compose ps                                        # all healthy
sudo docker exec postdelegate-staging-temporal-server-1 temporal task-queue describe --task-queue main --address temporal-server:7233
curl -s -o /dev/null -w '%{http_code}\n' https://staging.postdelegate.com/            # 401 (basic auth)
curl -s -o /dev/null -w '%{http_code}\n' https://staging.postdelegate.com/api/public/v1/integrations   # 401 from the app: "No API Key found"
curl -s -o /dev/null -w '%{http_code}\n' --user-agent 'PostDelegate-operations-verification/1.0' https://app.postdelegate.com/auth/login   # 200
free -m                                                               # keep more than about 1.5 GB available
```

## Stripe test mode

Staging uses the same Stripe account as production, in **test mode**, so no real card is ever charged. Live keys must never go into `staging.env`.

1. The owner copies the test keys from the Stripe Dashboard (toggle **Test mode**, Developers → API keys) and installs them without them appearing anywhere:

   ```sh
   deploy/postdelegate/set-secret.sh STRIPE_SECRET_KEY /etc/postiz/staging.env       # sk_test_...
   deploy/postdelegate/set-secret.sh STRIPE_PUBLISHABLE_KEY /etc/postiz/staging.env  # pk_test_...
   ```

2. On the server, create the test prices (same `lookup_key`s and amounts as production), the staging webhook endpoint and the portal configuration, then install the two values the script writes:

   ```sh
   sudo mkdir -m 700 -p /root/stripe-out
   sudo docker run --rm --env-file /etc/postiz/staging.env \
     -v /opt/postiz/builds/<rev>/deploy/postdelegate/staging/stripe-test-setup.js:/setup.js:ro \
     -v /root/stripe-out:/out -e NODE_PATH=/app/node_modules \
     --entrypoint node postdelegate-postiz:release-<rev> /setup.js /out
   ```

   Then append `STRIPE_SIGNING_KEY` and `STRIPE_PORTAL_CONFIGURATION` from `/root/stripe-out` to `/etc/postiz/staging.env` (root, never echoed), delete `/root/stripe-out`, and `sudo postiz-staging-compose up -d --force-recreate app`.

The script refuses a non-`sk_test_` key and a non-staging `FRONTEND_URL`. Test cards: `4242 4242 4242 4242` (success), `4000 0000 0000 0341` (attaches, then fails on charge — for failed renewals). Stripe's test clocks advance a subscription through trial end and renewals.
