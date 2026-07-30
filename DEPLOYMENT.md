# Deployment

Do not deploy this branch yet. The private R2 buckets already exist:

- `swapshelf-uploads` (production, 7 GiB application quota)
- `swapshelf-uploads-preview` (preview, 1 GiB application quota)

Before the first reviewed deployment:

1. Confirm the production and preview D1 bindings in `wrangler.jsonc`; both real database IDs are already configured.
2. Inspect both remote schemas before migration and confirm the existing `listings` table uses `tags_json` and `image_keys_json`.
3. Run `npm run db:migrate:production` and `npm run db:migrate:preview`. Only `0002_add_storage_quota.sql` may be applied; it preserves `listings` and adds object metadata plus the singleton usage counter.
4. Keep public R2 access disabled for both buckets.
5. Add admin secrets with `wrangler secret put` and optionally add both SendGrid secrets.
6. Run `npm run ci` and review both production and preview dry-run bundles before deploying.
7. Connect Workers Builds to GitHub only when the PR is ready; enable previews and confirm preview uses the preview D1 database, preview R2 bucket, and 1 GiB quota.
8. After approval, deploy and verify quota usage, upload rollback, moderation deletion, `/health`, ISBN lookup, and optional email.
