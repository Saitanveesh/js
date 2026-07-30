# Codex instructions for SwapShelf

## Product boundary
SwapShelf is currently a prototype for students to list books and study notes, browse published listings, and email a resource owner. Preserve that scope unless an issue explicitly expands it.

## Architecture
- `server.js`: Express application, sessions, uploads, ISBN lookup, and optional SendGrid delivery.
- `views/pages/home.ejs`: single-page server-rendered shell.
- `public/js/app.js`: browser state, filtering, moderation, dialogs, and API calls.
- `public/css/style.css`: responsive visual system.
- Listings are currently stored in browser `localStorage`. Do not imply multi-user persistence until a database-backed API is implemented.

## Working rules
1. Never commit `.env`, API keys, credentials, uploaded user files, email addresses, payment details, or local machine paths.
2. Keep request validation on the server even when browser validation exists.
3. Escape user-controlled text before inserting it into HTML.
4. Keep uploads limited by count, size, and MIME type.
5. Do not add hard-coded admin credentials or a production session fallback.
6. Run `npm run ci` before proposing a change.
7. Keep changes focused. Do not replace the stack merely because another framework is fashionable this week.

## Priority backlog
1. Replace `localStorage` with persistent server-side listing CRUD.
2. Add authenticated user accounts and ownership checks.
3. Store uploads in managed object storage.
4. Add CSRF protection and a production session store.
5. Add integration tests for uploads, login, listing creation, and email failures.
6. Add deployment configuration only after the target platform is chosen.
