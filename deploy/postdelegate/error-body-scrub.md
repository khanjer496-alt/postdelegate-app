# Scrubbing the stored error bodies

`Errors.body` is the debug snapshot of the posts a workflow was publishing
when it failed. Until this release it stored whole post rows, including the
**decrypted** channel credentials (`token`, `refreshToken`,
`customInstanceDetails`) and the `submittedForOrder` tree. New rows now go
through an allowlist (`auditErrorBody` in
`libraries/nestjs-libraries/src/database/prisma/errors/errors.audit.body.ts`):
each post keeps only the fields needed to debug it, and its integration only
`id`, `name` and `providerIdentifier`.

Every reader (the admin errors view, the post debug export, the debug
timeline) also passes stored bodies through the same allowlist, so the old rows
stop showing credentials **the moment this release serves traffic**. The scrub
below removes them from the database itself. At the time of writing production
held 2 such rows, both in the owner's own test workspace.

---

## 1. Deploy the release first

Run the scrub only once the app container is on the release that contains it.
The backend and the orchestrator share that one image here, so this also means
the workers write allowlisted bodies from then on. Run it earlier, from an old
container, and the command is not there; run it while an old orchestrator is
still writing, and new unfiltered rows can land after the scrub passed them.

## 2. Back up

```bash
sudo backup-postiz
```

The scrub rewrites a column in place and cannot be undone except by restoring
that backup.

## 3. Dry run

The release image wraps the command as `scrub-error-bodies`, the same way it
wraps `backfill-secrets`:

```bash
sudo postiz-compose exec -T postiz scrub-error-bodies --dry-run
```

It writes nothing and prints `done {...}` with:

- `bodies`: `scanned`, `updated` (rows it would rewrite), `unchanged` (already
  allowlisted), `skippedChanged`;
- `tokenLike`: for `Errors.message` and `Post.error`, how many rows contain each
  of `Bearer `, `access_token=`, `refresh_token`, `EAA`, `ya29.` and
  `"token":"`. Counts only, never the rows. These two columns are **not**
  rewritten (changing what a persisted column holds needs its own decision).
  `EAA` also matches ordinary text, so a count is a reason to look, not proof.
  The counts are unindexed `LIKE '%...%'` scans over both tables, so on a large
  database they are slow and can hit a statement timeout. If they fail the
  command prints `token-like counts unavailable`, reports `tokenLike: null`
  and keeps the rewrite's exit code.

## 4. Real run

```bash
sudo postiz-compose exec -T postiz scrub-error-bodies
```

Idempotent and resumable: an allowlisted body comes back unchanged and is not
written, so it can be re-run at any time. `--batch-size=200` is the default.
Every write is compare-and-swap on the body it read, so a row that changed or
was erased while it ran is counted as `skippedChanged` and left alone.

Exit codes: `0` done, `2` some rows were `skippedChanged` (re-run to pick them
up), `1` it failed (rows already rewritten stay rewritten; fix the cause and
re-run). The `tokenLike` counts do not affect the exit code, since nothing here
rewrites those columns: read them. It never logs a value, only counts.

Then run it a second time. It **must** report `updated: 0`: anything else means
something is still writing unfiltered bodies (check that every container is on
the new release, step 1) and the scrub is not done.

## 5. Copies the scrub does not reach

- **Backups.** The local backups under `/var/backups/postiz` and the encrypted
  off-site backups (14 daily + 8 weekly in R2) keep the old rows until their
  retention expires. Nothing to do but let them age out. The off-site copies are
  encrypted to a key that is never on the VPS; the local ones are not, so they
  are only as safe as root on the server.
- **A restore brings them back.** After restoring any backup taken before the
  scrub, run steps 3 and 4 again on the restored database.
- **Temporal workflow history.** The workflows passed the same posts to the
  `changeState` activity, so the activity inputs in Temporal's history hold
  them too. Closed workflow history is kept for 24 hours (archival disabled),
  then deleted by Temporal; a workflow that is still open keeps its history
  until it closes. The Temporal database dumps in the backups above hold it
  for as long as those backups live.
