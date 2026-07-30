require('dotenv').config();

const compression = require('compression');
const express = require('express');
const rateLimit = require('express-rate-limit');
const session = require('express-session');
const helmet = require('helmet');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const https = require('https');

const app = express();
const isProduction = process.env.NODE_ENV === 'production';
const uploadDir = path.join(__dirname, 'public', 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });

app.disable('x-powered-by');
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(express.urlencoded({ extended: false, limit: '100kb' }));
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  name: 'swapshelf.sid',
  secret: process.env.SESSION_SECRET || 'development-only-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    maxAge: 24 * 60 * 60 * 1000
  }
}));

const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 100 });
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10 });
app.use('/api', apiLimiter);

function clean(value, max = 500) {
  return String(value || '').trim().slice(0, max);
}

function isAdmin(req) {
  return Boolean(req.session && req.session.isAdmin);
}

function verifyAdmin(username, password) {
  const expectedUser = process.env.ADMIN_USERNAME;
  const expectedPassword = process.env.ADMIN_PASSWORD;
  if (!expectedUser || !expectedPassword) return false;
  return clean(username, 100).toLowerCase() === expectedUser.trim().toLowerCase()
    && clean(password, 200) === expectedPassword;
}

const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const storage = multer.diskStorage({
  destination: (_req, _file, callback) => callback(null, uploadDir),
  filename: (_req, file, callback) => {
    const ext = path.extname(file.originalname).toLowerCase();
    callback(null, `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024, files: 5 },
  fileFilter: (_req, file, callback) => {
    callback(allowedTypes.has(file.mimetype) ? null : new Error('Only JPG, PNG, and WebP images are allowed.'), allowedTypes.has(file.mimetype));
  }
});

app.get('/', (req, res) => {
  res.render('pages/home', { isAdmin: isAdmin(req) });
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'swapshelf' });
});

app.get('/api/admin/status', (req, res) => {
  res.json({ isAdmin: isAdmin(req) });
});

app.post('/admin/login', loginLimiter, (req, res) => {
  if (!verifyAdmin(req.body.username, req.body.password)) {
    return res.status(401).json({ success: false, message: 'Invalid credentials.' });
  }
  req.session.isAdmin = true;
  return res.json({ success: true });
});

app.post('/admin/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

app.post('/api/resources', upload.array('images', 5), (req, res) => {
  const required = ['type', 'title', 'author_subject', 'description', 'condition', 'location', 'owner_email'];
  const missing = required.filter((field) => !clean(req.body[field]));
  if (missing.length) {
    for (const file of req.files || []) fs.rm(file.path, { force: true }, () => {});
    return res.status(400).json({ success: false, message: `Missing: ${missing.join(', ')}` });
  }

  const email = clean(req.body.owner_email, 254);
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    return res.status(400).json({ success: false, message: 'Enter a valid owner email.' });
  }

  const resource = {
    id: `listing_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type: clean(req.body.type, 20).toUpperCase(),
    title: clean(req.body.title, 160),
    author_subject: clean(req.body.author_subject, 160),
    description: clean(req.body.description, 2000),
    condition: clean(req.body.condition, 40),
    location: clean(req.body.location, 160),
    owner_email: email,
    tags: clean(req.body.tags, 500).split(',').map((tag) => tag.trim()).filter(Boolean).slice(0, 12),
    images: (req.files || []).map((file) => `/uploads/${file.filename}`),
    status: 'PENDING',
    featured: false,
    created_at: new Date().toISOString()
  };

  return res.status(201).json({ success: true, resource });
});

app.get('/api/isbn/:isbn', async (req, res) => {
  const isbn = clean(req.params.isbn, 20).replace(/[^0-9Xx]/g, '');
  if (!isbn) return res.status(400).json({ success: false, message: 'ISBN required.' });

  try {
    const url = `https://www.googleapis.com/books/v1/volumes?q=isbn:${encodeURIComponent(isbn)}`;
    const data = await new Promise((resolve, reject) => {
      https.get(url, (response) => {
        let body = '';
        response.on('data', (chunk) => { body += chunk; });
        response.on('end', () => {
          try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
        });
      }).on('error', reject);
    });
    const book = data.items?.[0]?.volumeInfo;
    if (!book) return res.json({ success: false, message: 'No book found.' });
    return res.json({ success: true, book: {
      title: book.title || '',
      authors: book.authors || [],
      description: book.description || '',
      categories: book.categories || []
    }});
  } catch (error) {
    console.error('ISBN lookup failed:', error.message);
    return res.status(502).json({ success: false, message: 'ISBN lookup failed.' });
  }
});

app.post('/api/send-request-email', async (req, res) => {
  const fields = ['owner_email', 'requester_name', 'requester_email', 'message', 'resource_title'];
  const missing = fields.filter((field) => !clean(req.body[field]));
  if (missing.length) return res.status(400).json({ success: false, message: 'Missing required fields.' });

  if (!process.env.SENDGRID_API_KEY || !process.env.SENDGRID_FROM_EMAIL) {
    return res.status(503).json({ success: false, message: 'Email delivery is not configured.' });
  }

  const payload = JSON.stringify({
    personalizations: [{ to: [{ email: clean(req.body.owner_email, 254) }] }],
    from: { email: process.env.SENDGRID_FROM_EMAIL },
    reply_to: { email: clean(req.body.requester_email, 254) },
    subject: `SwapShelf request for ${clean(req.body.resource_title, 120)}`,
    content: [{
      type: 'text/plain',
      value: `${clean(req.body.requester_name, 100)} is interested in your resource.\n\n${clean(req.body.message, 2000)}`
    }]
  });

  try {
    await new Promise((resolve, reject) => {
      const request = https.request({
        hostname: 'api.sendgrid.com', path: '/v3/mail/send', method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        }
      }, (response) => response.statusCode >= 200 && response.statusCode < 300 ? resolve() : reject(new Error(`SendGrid ${response.statusCode}`)));
      request.on('error', reject);
      request.write(payload);
      request.end();
    });
    return res.json({ success: true });
  } catch (error) {
    console.error('Email delivery failed:', error.message);
    return res.status(502).json({ success: false, message: 'Email delivery failed.' });
  }
});

app.use((err, _req, res, _next) => {
  console.error(err.message);
  if (err instanceof multer.MulterError || err.message.includes('images are allowed')) {
    return res.status(400).json({ success: false, message: err.message });
  }
  return res.status(500).json({ success: false, message: 'Server error.' });
});

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  app.listen(port, () => console.log(`SwapShelf running on http://localhost:${port}`));
}

module.exports = app;
