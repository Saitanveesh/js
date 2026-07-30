# Deployment

Do not deploy this branch yet. The private R2 buckets already exist:

- `swapshelf-uploads` (production, 7 GiB application quota)
- `swapshelf-uploads-preview` (preview, 1 GiB application quota)

Before the first reviewed deployment:

1. Create D1 `swapshelf` and replace `REPLACE_WITH_D1_DATABASE_ID` in `wrangler.jsonc`.
2. Run `npm run db:migrate:remote` to create listings, object metadata, and the singleton usage counter.
3. Keep public R2 access disabled for both buckets.
4. Add admin secrets with `wrangler secret put` and optionally add both SendGrid secrets.
5. Run `npm run ci` and review the Cloudflare dry-run before deploying.
6. Connect Workers Builds to GitHub only when the PR is ready; enable previews and confirm preview uses the preview bucket and 1 GiB environment quota.
7. After approval, deploy and verify quota usage, upload rollback, moderation deletion, `/health`, ISBN lookup, and optional email.
