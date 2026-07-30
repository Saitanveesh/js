# Codex instructions for SwapShelf

SwapShelf is a Cloudflare Worker with static assets, D1 listing persistence, and private R2 uploads. Preserve the student books/notes prototype and existing UI. Never restore `localStorage` persistence or an Express-only backend.

Always validate inputs server-side, parameterize D1 queries, escape browser HTML, keep owner email private, and keep both R2 buckets private. Upload limits are five files and 5 MiB each. Hard quotas are 7 GiB production and 1 GiB preview. Capacity must be atomically reserved in D1 before R2 writes, counted as stored only after successful writes, repaired on rollback, and decremented only after successful deletion; counters must never be negative.

Never commit secrets, `.dev.vars`, `.env`, API tokens, uploaded files, or private data. Add new numbered migrations instead of editing an applied migration. Run `npm run ci` before proposing changes. Do not deploy unless the user explicitly asks.
