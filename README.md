# SwapShelf

SwapShelf is a student resource-sharing application for books and study notes. This branch converts the prototype into one Cloudflare Worker with Static Assets, D1 database storage, and private R2 file storage.

## Architecture

- `public/`: static HTML, CSS, and browser JavaScript
- `src/worker.js`: APIs, authentication, moderation, ISBN lookup, email, and media delivery
- `migrations/`: versioned Cloudflare D1 schema
- Cloudflare D1: shared listing records and private owner email
- Cloudflare R2: private uploaded images
- Cloudflare Workers Builds: automatic GitHub deployment and branch previews

## Commands

```bash
npm install
npm run check
npm test
npm run dev
npm run db:migrate:local
npm run db:migrate:remote
npm run deploy
```

## Required Cloudflare resources

Create these before production deployment:

- D1 database: `swapshelf`
- Preview D1 database: `swapshelf-preview`
- R2 bucket: `swapshelf-uploads`
- Preview R2 bucket: `swapshelf-uploads-preview`

Replace both D1 placeholders in `wrangler.jsonc` with the database UUIDs.

## Secrets

Set these as Cloudflare Worker secrets. Never commit them:

- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`
- `SESSION_SECRET`
- `SENDGRID_API_KEY` (optional)
- `SENDGRID_FROM_EMAIL` (optional)

For local development, copy `.env.example` to `.dev.vars`.

## Current behaviour

- Public users see only published listings.
- New listings enter `PENDING` status.
- Admin endpoints publish, unpublish, and delete listings.
- Owner email remains private in D1.
- Images are validated and stored in private R2.
- Contact email is optional and fails safely until SendGrid is configured.

See `DEPLOYMENT.md` for the account-side setup sequence.
