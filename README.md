# SwapShelf

SwapShelf is a student resource-sharing prototype for listing books and study notes, browsing available resources, and contacting resource owners.

## Current scope

- Single-page EJS interface
- Book and notes listings
- Image uploads, limited to five images per listing
- ISBN lookup through Google Books
- Session-based admin login
- Optional request emails through SendGrid
- Browser `localStorage` for listing data

The last point matters: this is currently a prototype, not a production marketplace. Listings are stored in each browser and are not shared across users. The backend validates submissions and stores uploaded images, but a database-backed listing service is still the next major feature.

## Run locally

Requirements: Node.js 20 or newer.

```bash
cp .env.example .env
npm install
npm run dev
```

Open `http://localhost:3000`.

For production, set a long random `SESSION_SECRET`, strong admin credentials, and a verified SendGrid sender. Never commit `.env`.

## Useful commands

```bash
npm run check
npm test
npm run ci
npm start
```

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `PORT` | No | HTTP port, defaults to `3000` |
| `NODE_ENV` | No | Set to `production` in deployment |
| `SESSION_SECRET` | Production | Signs the session cookie |
| `ADMIN_USERNAME` | For admin login | Admin account name |
| `ADMIN_PASSWORD` | For admin login | Admin account password |
| `SENDGRID_API_KEY` | For email | SendGrid API key |
| `SENDGRID_FROM_EMAIL` | For email | Verified sender address |

## Repository layout

```text
.
├── .github/workflows/ci.yml
├── middleware/
│   ├── auth.js
│   ├── upload.js
│   └── validation.js
├── public/
│   ├── css/style.css
│   ├── images/upi-qr.png
│   ├── js/app.js
│   └── uploads/.gitkeep
├── test/app.test.js
├── views/pages/home.ejs
├── AGENTS.md
├── package.json
└── server.js
```

## Security decisions already applied

- Secrets and uploaded user files are excluded from Git.
- API keys are never printed to logs.
- Admin credentials have no hard-coded fallback.
- Uploaded file types and sizes are restricted.
- Login and form endpoints are rate-limited.
- Session cookies use `httpOnly` and `sameSite=lax`.
- Request bodies are normalized and length-limited.

## Next engineering milestone

Replace browser `localStorage` with server-side persistence and authenticated CRUD APIs. Until that is done, admin moderation and listings are device-local, which is charming in the same way a cardboard door lock is charming.
