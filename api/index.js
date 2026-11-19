import express from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import pg from 'pg';

const { Pool } = pg;
pg.types.setTypeParser(20, (val) => parseInt(val, 10));
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const DATABASE_URL   = process.env.DATABASE_URL;
const IS_PROD        = process.env.NODE_ENV === 'production';

if (!DATABASE_URL) {
  console.error('DATABASE_URL is not set');
}

// ── PostgreSQL pool ───────────────────────────────────────────
const pool = DATABASE_URL ? new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 5000,
}) : null;

if (pool) {
  pool.on('error', (err) => {
    console.error('PostgreSQL pool error:', err.message);
  });
}

// ── Uploads dir (Vercel /tmp is writable) ─────────────────────
const UPLOADS_DIR = '/tmp/uploads';
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// ── Express ───────────────────────────────────────────────────
const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

app.use(express.json({ limit: '15mb' }));

// Serve uploaded images from /tmp/uploads
app.use('/uploads', (req, res) => {
  const filename = path.basename(req.path);
  const filepath = path.join(UPLOADS_DIR, filename);
  if (fs.existsSync(filepath)) {
    res.sendFile(filepath);
  } else {
    res.status(404).json({ error: 'Not found' });
  }
});

// ── Auth ──────────────────────────────────────────────────────
const AUTH_SECRET = process.env.ADMIN_PASSWORD || 'std-score-admin-secret-2026';

function generateToken() {
  const timestamp = Date.now();
  const signature = crypto.createHmac('sha256', AUTH_SECRET).update(`admin:${timestamp}`).digest('hex');
  return `${timestamp}.${signature}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [timestamp, signature] = parts;
  const time = parseInt(timestamp, 10);
  if (isNaN(time)) return false;
  if (Date.now() - time > 7 * 24 * 60 * 60 * 1000) return false;
  try {
    const expected = crypto.createHmac('sha256', AUTH_SECRET).update(`admin:${timestamp}`).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch (_) {
    return false;
  }
}

async function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token  = header.replace(/^Bearer\s+/i, '').trim();
  if (!token) return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบ' });

  if (verifyToken(token)) return next();

  if (pool) {
    try {
      const { rows } = await pool.query(
        'SELECT 1 FROM admin_sessions WHERE token = $1 AND expires_at > NOW()',
        [token]
      );
      if (rows.length > 0) return next();
    } catch (_) {}
  }

  return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบ' });
}

// ── Helpers ───────────────────────────────────────────────────
function savePicture(dataUrl, id_std) {
  const m = String(dataUrl).match(/^data:image\/(\w+);base64,(.+)$/);
  if (!m) return null;
  const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
  const filename = `${id_std}_${Date.now()}.${ext}`;
  fs.writeFileSync(path.join(UPLOADS_DIR, filename), Buffer.from(m[2], 'base64'));
  return filename;
}

function deletePicture(filename) {
  if (!filename) return;
  const p = path.join(UPLOADS_DIR, filename);
  try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (_) {}
}

function cleanSubject(sub) {
  if (!sub || typeof sub !== 'object') return null;
  const name = String(sub.name || '').trim();
  if (!name) return null;
  const score = Number(sub.score);
  return { name, score: Number.isFinite(score) ? score : 0 };
}

async function getSubjects(client, studentId) {
  const { rows } = await client.query(
    'SELECT name, score FROM subjects WHERE student_id = $1 ORDER BY id',
    [studentId]
  );
  return rows.map(s => ({ name: s.name, score: parseFloat(s.score) }));
}

async function publicStudent(client, row) {
  return {
    id:       parseInt(row.id, 10),
    id_std:   row.id_std,
    name:     row.name,
    picture:  row.picture ? `/uploads/${row.picture}` : null,
    subjects: await getSubjects(client, row.id),
  };
}

// ── Routes ────────────────────────────────────────────────────

app.get('/health', async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ status: 'error', db: 'no DATABASE_URL' });
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected' });
  } catch (e) {
    res.status(503).json({ status: 'error', db: e.message });
  }
});

app.post('/api/login', async (req, res) => {
  const { password, username } = req.body || {};
  let isValid = false;

  if (password === ADMIN_PASSWORD) {
    isValid = true;
  }

  if (!isValid && pool) {
    try {
      const { rows } = await pool.query(
        'SELECT 1 FROM admins WHERE (username = $1 OR username = \'admin\') AND password = $2',
        [username || 'admin', password]
      );
      if (rows.length > 0) isValid = true;
    } catch (e) {
      console.error('DB Admin check error:', e.message);
    }
  }

  if (isValid) {
    const token = generateToken();
    if (pool) {
      pool.query(
        'INSERT INTO admin_sessions (token) VALUES ($1) ON CONFLICT (token) DO NOTHING',
        [token]
      ).catch(() => {});
    }
    return res.json({ token });
  }

  res.status(401).json({ error: 'รหัสผ่านไม่ถูกต้อง' });
});

app.get('/api/student/:id_std', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Database not configured' });
  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      'SELECT * FROM students WHERE id_std = $1', [req.params.id_std]
    );
    if (!rows.length) return res.status(404).json({ error: 'ไม่พบรหัสนักเรียนนี้' });
    res.json(await publicStudent(client, rows[0]));
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

app.get('/api/admin/students', auth, async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Database not configured' });
  const client = await pool.connect();
  try {
    const { rows } = await client.query('SELECT * FROM students ORDER BY id');
    const result = await Promise.all(rows.map(r => publicStudent(client, r)));
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

app.post('/api/admin/students', auth, async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Database not configured' });
  const { id_std, name, picture, subjects } = req.body || {};
  if (!id_std || !String(id_std).trim())
    return res.status(400).json({ error: 'กรุณาระบุรหัสนักเรียน (ID STD)' });

  let pictureFile = null;
  if (picture && String(picture).startsWith('data:image'))
    pictureFile = savePicture(picture, id_std);

  const cleanSubs = (Array.isArray(subjects) ? subjects : []).map(cleanSubject).filter(Boolean);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'INSERT INTO students (id_std, name, picture) VALUES ($1, $2, $3) RETURNING *',
      [id_std, name || '', pictureFile]
    );
    const sid = rows[0].id;
    for (const s of cleanSubs) {
      await client.query(
        'INSERT INTO subjects (student_id, name, score) VALUES ($1, $2, $3)',
        [sid, s.name, s.score]
      );
    }
    await client.query('COMMIT');
    res.status(201).json(await publicStudent(client, rows[0]));
  } catch (e) {
    await client.query('ROLLBACK');
    deletePicture(pictureFile);
    if (e.code === '23505') return res.status(409).json({ error: 'รหัสนักเรียนซ้ำในระบบ' });
    res.status(500).json({ error: 'บันทึกไม่สำเร็จ' });
  } finally {
    client.release();
  }
});

app.put('/api/admin/students/:id', auth, async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Database not configured' });
  const id = parseInt(req.params.id, 10);
  const { id_std, name, picture, subjects, clearPicture } = req.body || {};
  const client = await pool.connect();
  try {
    const { rows } = await client.query('SELECT * FROM students WHERE id = $1', [id]);
    if (!rows.length) return res.status(404).json({ error: 'ไม่พบนักเรียน' });
    const row = rows[0];

    if (id_std && id_std !== row.id_std) {
      const dup = await client.query(
        'SELECT 1 FROM students WHERE id_std = $1 AND id != $2', [id_std, id]
      );
      if (dup.rows.length) return res.status(409).json({ error: 'รหัสนักเรียนซ้ำในระบบ' });
    }

    let newPic = row.picture;
    if (clearPicture) { deletePicture(row.picture); newPic = null; }
    else if (picture && String(picture).startsWith('data:image')) {
      deletePicture(row.picture);
      newPic = savePicture(picture, id_std || row.id_std);
    }

    await client.query('BEGIN');
    const updated = await client.query(
      'UPDATE students SET id_std=$1, name=$2, picture=$3 WHERE id=$4 RETURNING *',
      [id_std || row.id_std, name !== undefined ? name : row.name, newPic, id]
    );
    if (subjects !== undefined) {
      await client.query('DELETE FROM subjects WHERE student_id = $1', [id]);
      for (const s of (Array.isArray(subjects) ? subjects : []).map(cleanSubject).filter(Boolean)) {
        await client.query(
          'INSERT INTO subjects (student_id, name, score) VALUES ($1, $2, $3)',
          [id, s.name, s.score]
        );
      }
    }
    await client.query('COMMIT');
    res.json(await publicStudent(client, updated.rows[0]));
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    if (e.code === '23505') return res.status(409).json({ error: 'รหัสนักเรียนซ้ำในระบบ' });
    res.status(500).json({ error: e.message || 'บันทึกไม่สำเร็จ' });
  } finally {
    client.release();
  }
});

app.delete('/api/admin/students/:id', auth, async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Database not configured' });
  const id = parseInt(req.params.id, 10);
  const client = await pool.connect();
  try {
    const { rows } = await client.query('SELECT picture FROM students WHERE id = $1', [id]);
    if (!rows.length) return res.status(404).json({ error: 'ไม่พบนักเรียน' });
    await client.query('DELETE FROM students WHERE id = $1', [id]);
    deletePicture(rows[0].picture);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

app.use((err, req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

export default app;
