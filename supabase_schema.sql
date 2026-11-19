-- ============================================================
--  ระบบตรวจสอบคะแนน (STD_Score) — Supabase / PostgreSQL Schema
--  วิธีใช้: ไปที่ Supabase → SQL Editor → วางโค้ดนี้ทั้งหมด → กด Run
-- ============================================================

-- ── 1. ตาราง Admins (ระบบผู้ดูแลระบบ) ──────────────────────────
CREATE TABLE IF NOT EXISTS admins (
  id         BIGSERIAL    PRIMARY KEY,
  username   VARCHAR(100) UNIQUE NOT NULL DEFAULT 'admin',
  password   VARCHAR(255) NOT NULL DEFAULT 'admin123',
  created_at TIMESTAMPTZ  DEFAULT NOW()
);

-- ── 2. ตาราง Admin Sessions (เก็บ Token การเข้าสู่ระบบ) ────────
CREATE TABLE IF NOT EXISTS admin_sessions (
  id         BIGSERIAL    PRIMARY KEY,
  token      TEXT         UNIQUE NOT NULL,
  created_at TIMESTAMPTZ  DEFAULT NOW(),
  expires_at TIMESTAMPTZ  DEFAULT NOW() + INTERVAL '7 days'
);

-- ── 3. ตาราง Students (ข้อมูลนักเรียน) ─────────────────────────
CREATE TABLE IF NOT EXISTS students (
  id         BIGSERIAL    PRIMARY KEY,
  id_std     VARCHAR(50)  UNIQUE NOT NULL,
  name       VARCHAR(255) NOT NULL DEFAULT '',
  picture    TEXT         DEFAULT NULL,
  created_at TIMESTAMPTZ  DEFAULT NOW()
);

-- ── 4. ตาราง Subjects (รายวิชาและคะแนน) ───────────────────────
CREATE TABLE IF NOT EXISTS subjects (
  id         BIGSERIAL    PRIMARY KEY,
  student_id BIGINT       NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  name       VARCHAR(255) NOT NULL,
  score      NUMERIC(6,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ  DEFAULT NOW()
);

-- ── 5. Index เพื่อค้นหาได้รวดเร็ว ────────────────────────────
CREATE INDEX IF NOT EXISTS idx_students_id_std      ON students (id_std);
CREATE INDEX IF NOT EXISTS idx_subjects_student     ON subjects (student_id);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_token ON admin_sessions (token);

-- ── 6. ข้อมูลเริ่มต้น (Default Admin & Sample Students) ───────

-- Admin เริ่มต้น: user = admin, password = admin123
INSERT INTO admins (username, password) VALUES
  ('admin', 'admin123')
ON CONFLICT (username) DO NOTHING;

-- นักเรียนตัวอย่าง
INSERT INTO students (id_std, name, picture) VALUES
  ('66010001', 'สมชาย ใจดี',      NULL),
  ('66010002', 'สมหญิง รักเรียน', NULL)
ON CONFLICT (id_std) DO NOTHING;

-- คะแนนรายวิชาของ 66010001
INSERT INTO subjects (student_id, name, score)
SELECT s.id, 'คณิตศาสตร์', 85 FROM students s WHERE s.id_std = '66010001'
ON CONFLICT DO NOTHING;

INSERT INTO subjects (student_id, name, score)
SELECT s.id, 'ภาษาไทย', 78 FROM students s WHERE s.id_std = '66010001'
ON CONFLICT DO NOTHING;

INSERT INTO subjects (student_id, name, score)
SELECT s.id, 'ภาษาอังกฤษ', 82 FROM students s WHERE s.id_std = '66010001'
ON CONFLICT DO NOTHING;

-- คะแนนรายวิชาของ 66010002
INSERT INTO subjects (student_id, name, score)
SELECT s.id, 'คณิตศาสตร์', 92 FROM students s WHERE s.id_std = '66010002'
ON CONFLICT DO NOTHING;

INSERT INTO subjects (student_id, name, score)
SELECT s.id, 'ภาษาไทย', 88 FROM students s WHERE s.id_std = '66010002'
ON CONFLICT DO NOTHING;

INSERT INTO subjects (student_id, name, score)
SELECT s.id, 'วิทยาศาสตร์', 90 FROM students s WHERE s.id_std = '66010002'
ON CONFLICT DO NOTHING;
