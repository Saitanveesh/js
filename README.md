# SwapShelf

SwapShelf is a Cloudflare Worker with Static Assets. Listings live in D1 and private images live in R2; the browser no longer uses `localStorage` as its source of truth.

## Storage safety

The application enforces a hard combined stored-plus-reserved quota before writing to R2:

- production (`swapshelf-uploads`): **7 GiB** (`7516192768` bytes)
- preview (`swapshelf-uploads-preview`): **1 GiB** (`1073741824` bytes)
- at most five images per listing and 5 MiB per image

D1's singleton `storage_usage` row atomically reserves capacity. Each object's bytes move from reserved to stored only after `R2.put` succeeds. Failures delete already-uploaded objects and repair both counters. Successful moderation deletion removes the object before decrementing stored bytes, with SQL `MAX(0, ...)` preventing negative usage. Both buckets must remain private; files are read only through `/media/*`.

## Local development

```bash
npm install
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev
npm run ci
```

## Cloudflare setup

Replace `REPLACE_WITH_D1_DATABASE_ID` in `wrangler.jsonc`, apply `npm run db:migrate:remote`, and configure `ADMIN_USERNAME`, `ADMIN_PASSWORD`, and `SESSION_SECRET` as Worker secrets. SendGrid remains optional through `SENDGRID_API_KEY` and `SENDGRID_FROM_EMAIL`. Do not deploy this quota change until its PR is reviewed and the migration is applied.
