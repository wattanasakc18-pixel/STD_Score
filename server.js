import express from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { DatabaseSync } from 'node:sqlite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const IS_PROD = process.env.NODE_ENV === 'production';

// ── Directories ──────────────────────────────────────────────
const DATA_DIR    = path.join(__dirname, 'data');
const DB_PATH     = path.join(DATA_DIR, 'scores.db');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const PUBLIC_DIR  = path.join(__dirname, 'public');

[DATA_DIR, UPLOADS_DIR].forEach((d) => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

// ── SQLite ────────────────────────────────────────────────────
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS students (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  id_std   TEXT UNIQUE NOT NULL,
  name     TEXT NOT NULL DEFAULT '',
  picture  TEXT
);
CREATE TABLE IF NOT EXISTS subjects (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  score      REAL NOT NULL DEFAULT 0
);
`);

// Seed sample data on first run
if (db.prepare('SELECT COUNT(*) AS c FROM students').get().c === 0) {
  const insS = db.prepare('INSERT INTO students (id_std, name, picture) VALUES (?, ?, ?)');
  const insSub = db.prepare('INSERT INTO subjects (student_id, name, score) VALUES (?, ?, ?)');
  db.exec('BEGIN');
  try {
    const seed = [
      { id_std: '66010001', name: 'สมชาย ใจดี',      subs: [['คณิตศาสตร์',85],['ภาษาไทย',78],['ภาษาอังกฤษ',82]] },
      { id_std: '66010002', name: 'สมหญิง รักเรียน',  subs: [['คณิตศาสตร์',92],['ภาษาไทย',88],['วิทยาศาสตร์',90]] },
    ];
    for (const s of seed) {
      const { lastInsertRowid: sid } = insS.run(s.id_std, s.name, null);
      for (const [n, sc] of s.subs) insSub.run(sid, n, sc);
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

// ── Express config ────────────────────────────────────────────
app.set('trust proxy', 1);                      // needed behind Render/Railway proxy
app.disable('x-powered-by');                    // hide Express fingerprint

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

function publicStudent(row) {
  const subs = db.prepare('SELECT name, score FROM subjects WHERE student_id = ?').all(row.id);
  return {
    id:       row.id,
    id_std:   row.id_std,
    name:     row.name,
    picture:  row.picture ? `/uploads/${row.picture}` : null,
    subjects: subs.map(s => ({ name: s.name, score: s.score })),
  };
}

// ── Routes ────────────────────────────────────────────────────

// Public: health check (for Render/Railway zero-downtime deploy)
app.get('/health', (_, res) => res.json({ status: 'ok' }));

// Public: login
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
app.get('/api/student/:id_std', (req, res) => {
  const row = db.prepare('SELECT * FROM students WHERE id_std = ?').get(req.params.id_std);
  if (!row) return res.status(404).json({ error: 'ไม่พบรหัสนักเรียนนี้' });
  res.json(publicStudent(row));
});

// Admin: list
app.get('/api/admin/students', auth, (req, res) => {
  const rows = db.prepare('SELECT * FROM students ORDER BY id').all();
  res.json(rows.map(publicStudent));
});

// Admin: create
app.post('/api/admin/students', auth, (req, res) => {
  const { id_std, name, picture, subjects } = req.body || {};
  if (!id_std || !String(id_std).trim())
    return res.status(400).json({ error: 'กรุณาระบุรหัสนักเรียน (ID STD)' });
  if (db.prepare('SELECT 1 FROM students WHERE id_std = ?').get(id_std))
    return res.status(409).json({ error: 'รหัสนักเรียนซ้ำในระบบ' });

  let pictureFile = null;
  if (picture && String(picture).startsWith('data:image'))
    pictureFile = savePicture(picture, id_std);

  const cleanSubs = (Array.isArray(subjects) ? subjects : []).map(cleanSubject).filter(Boolean);

  let newId;
  try {
    newId = tx(() => {
      const { lastInsertRowid: sid } = db
        .prepare('INSERT INTO students (id_std, name, picture) VALUES (?, ?, ?)')
        .run(id_std, name || '', pictureFile);
      const insSub = db.prepare('INSERT INTO subjects (student_id, name, score) VALUES (?, ?, ?)');
      for (const s of cleanSubs) insSub.run(sid, s.name, s.score);
      return sid;
    });
  } catch (e) {
    deletePicture(pictureFile);
    if (String(e.message).includes('UNIQUE'))
      return res.status(409).json({ error: 'รหัสนักเรียนซ้ำในระบบ' });
    return res.status(500).json({ error: 'บันทึกไม่สำเร็จ' });
  }

  res.status(201).json(publicStudent(db.prepare('SELECT * FROM students WHERE id = ?').get(newId)));
});

// Admin: update
app.put('/api/admin/students/:id', auth, (req, res) => {
  const id  = parseInt(req.params.id, 10);
  const row = db.prepare('SELECT * FROM students WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'ไม่พบนักเรียน' });

  const { id_std, name, picture, subjects, clearPicture } = req.body || {};

  if (id_std && id_std !== row.id_std) {
    if (db.prepare('SELECT 1 FROM students WHERE id_std = ? AND id != ?').get(id_std, id))
      return res.status(409).json({ error: 'รหัสนักเรียนซ้ำในระบบ' });
  }

  let newPic = row.picture;
  if (clearPicture) { deletePicture(row.picture); newPic = null; }
  else if (picture && String(picture).startsWith('data:image')) {
    deletePicture(row.picture);
    newPic = savePicture(picture, id_std || row.id_std);
  }

  try {
    tx(() => {
      db.prepare('UPDATE students SET id_std = ?, name = ?, picture = ? WHERE id = ?')
        .run(id_std || row.id_std, name !== undefined ? name : row.name, newPic, id);
      if (subjects !== undefined) {
        db.prepare('DELETE FROM subjects WHERE student_id = ?').run(id);
        const insSub = db.prepare('INSERT INTO subjects (student_id, name, score) VALUES (?, ?, ?)');
        for (const s of (Array.isArray(subjects) ? subjects : []).map(cleanSubject).filter(Boolean))
          insSub.run(id, s.name, s.score);
      }
    });
  } catch (e) {
    if (newPic !== row.picture) deletePicture(newPic);
    return res.status(500).json({ error: 'บันทึกไม่สำเร็จ' });
  }

  res.json(publicStudent(db.prepare('SELECT * FROM students WHERE id = ?').get(id)));
});

// Admin: delete
app.delete('/api/admin/students/:id', auth, (req, res) => {
  const id  = parseInt(req.params.id, 10);
  const row = db.prepare('SELECT picture FROM students WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'ไม่พบนักเรียน' });
  db.prepare('DELETE FROM students WHERE id = ?').run(id);
  deletePicture(row.picture);
  res.json({ success: true });
});

// ── Global error handler ──────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Start ─────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n  📊 ระบบตรวจสอบคะแนน พร้อมที่ http://localhost:${PORT}`);
  console.log(`  💾 SQLite: ${DB_PATH}`);
  console.log(`  🔒 Admin password: ${IS_PROD ? '(set via ADMIN_PASSWORD env)' : ADMIN_PASSWORD}\n`);
});
