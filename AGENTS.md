# Codex instructions

## Goal
Keep SwapShelf deployable as one Cloudflare Worker with Static Assets, D1, and R2. Preserve the existing plain HTML/CSS/JavaScript interface unless a task explicitly requests redesign work.

## Commands

```bash
npm install
npm run check
npm test
npm run ci
npm run dev
npm run db:migrate:local
```

## Architecture rules

- Browser state must come from backend APIs, not `localStorage`.
- Shared records belong in D1.
- Uploaded files belong in private R2.
- Never return `owner_email` in public listing responses.
- Admin mutations must remain authenticated and same-origin checked.
- Use parameterized D1 queries.
- Add a numbered SQL migration for every schema change.
- Keep SendGrid optional and use its HTTP API.

## Secrets and files

Never commit `.env`, `.dev.vars`, API keys, passwords, session secrets, uploads, or `node_modules`.

## Deployment

- Production branch: `main`
- Production deploy command: `npx wrangler deploy`
- Preview command: `npx wrangler versions upload`
- D1 IDs in `wrangler.jsonc` are placeholders until the databases are created.
- Do not invent Cloudflare resource IDs.
