import express from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import pg from 'pg';

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT           = process.env.PORT           || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD  || 'admin123';
const DATABASE_URL   = process.env.DATABASE_URL;
const IS_PROD        = process.env.NODE_ENV === 'production';

if (!DATABASE_URL) {
  console.error('\n  ❌  DATABASE_URL is not set.');
  console.error('  Set it in .env or as an environment variable.\n');
  process.exit(1);
}

// ── PostgreSQL pool ───────────────────────────────────────────
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: IS_PROD ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('PostgreSQL pool error:', err.message);
});

// ── Directories ───────────────────────────────────────────────
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const PUBLIC_DIR  = path.join(__dirname, 'public');

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// ── Express config ────────────────────────────────────────────
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
app.use('/uploads', express.static(UPLOADS_DIR, { maxAge: IS_PROD ? '7d' : 0 }));
app.use(express.static(PUBLIC_DIR, { maxAge: IS_PROD ? '1h' : 0 }));

// ── Auth ──────────────────────────────────────────────────────
const tokens = new Set();

function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token  = header.replace('Bearer ', '');
  if (!token || !tokens.has(token))
    return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบ' });
  next();
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

async function getStudentWithSubjects(client, id) {
  const { rows: subs } = await client.query(
    'SELECT name, score FROM subjects WHERE student_id = $1 ORDER BY id',
    [id]
  );
  return subs.map(s => ({ name: s.name, score: parseFloat(s.score) }));
}

async function publicStudent(client, row) {
  const subjects = await getStudentWithSubjects(client, row.id);
  return {
    id:       row.id,
    id_std:   row.id_std,
    name:     row.name,
    picture:  row.picture ? `/uploads/${row.picture}` : null,
    subjects,
  };
}

// ── Routes ────────────────────────────────────────────────────

// Health check
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected' });
  } catch (e) {
    res.status(503).json({ status: 'error', db: e.message });
  }
});

// Login
app.post('/api/login', (req, res) => {
  const { password } = req.body || {};
  if (password === ADMIN_PASSWORD) {
    const token = crypto.randomBytes(24).toString('hex');
    tokens.add(token);
    return res.json({ token });
  }
  res.status(401).json({ error: 'รหัสผ่านไม่ถูกต้อง' });
});

// Public: lookup student
app.get('/api/student/:id_std', async (req, res) => {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      'SELECT * FROM students WHERE id_std = $1',
      [req.params.id_std]
    );
    if (!rows.length) return res.status(404).json({ error: 'ไม่พบรหัสนักเรียนนี้' });
    res.json(await publicStudent(client, rows[0]));
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// Admin: list all
app.get('/api/admin/students', auth, async (req, res) => {
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

// Admin: create
app.post('/api/admin/students', auth, async (req, res) => {
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

// Admin: update
app.put('/api/admin/students/:id', auth, async (req, res) => {
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
    res.status(500).json({ error: 'บันทึกไม่สำเร็จ' });
  } finally {
    client.release();
  }
});

// Admin: delete
app.delete('/api/admin/students/:id', auth, async (req, res) => {
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

// Global error handler
app.use((err, req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Start ─────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n  📊 ระบบตรวจสอบคะแนน พร้อมที่ http://localhost:${PORT}`);
  console.log(`  🐘 PostgreSQL: connected via DATABASE_URL`);
  console.log(`  🔒 Admin password: ${IS_PROD ? '(set via ADMIN_PASSWORD env)' : ADMIN_PASSWORD}\n`);
});
