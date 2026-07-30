# Cloudflare deployment

Complete these steps in order.

## 1. Create storage resources

In Cloudflare Dashboard:

1. Open **Storage & Databases → D1 SQL Database**.
2. Create `swapshelf`.
3. Create `swapshelf-preview`.
4. Copy both database UUIDs.
5. Replace the two D1 placeholders in `wrangler.jsonc`.
6. Open **R2 Object Storage**.
7. Create private buckets `swapshelf-uploads` and `swapshelf-uploads-preview`.

## 2. Apply database migrations

```bash
npm install
npx wrangler login
npm run db:migrate:remote
npx wrangler d1 migrations apply swapshelf-preview --remote
```

Confirm the target database shown by Wrangler before approving each command.

## 3. Create the Worker from GitHub

1. Open **Workers & Pages**.
2. Select **Create application**.
3. Select **Import a repository**.
4. Connect GitHub and select this repository.
5. Worker name must be `swapshelf`, matching `wrangler.jsonc`.
6. Production branch: `main`.
7. Deploy command: `npx wrangler deploy`.
8. Non-production deploy command: `npx wrangler versions upload`.
9. Enable builds for non-production branches.

## 4. Add secrets

Open the Worker, then **Settings → Variables and Secrets**. Add as encrypted secrets:

- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`
- `SESSION_SECRET`

Optional email secrets:

- `SENDGRID_API_KEY`
- `SENDGRID_FROM_EMAIL`

Generate a session secret locally:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

## 5. Verify production

1. Open the Worker URL.
2. Open `/api/health`; database and storage should both be `true`.
3. Submit a test listing.
4. Log in as admin and publish it.
5. Open an incognito window and confirm the listing is visible.
6. Delete the test listing and confirm its image no longer loads.

SendGrid can be configured later. It is not required for the first deployment.
