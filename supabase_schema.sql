-- ============================================================
--  ระบบตรวจสอบคะแนน — Supabase / PostgreSQL Schema
--  วิธีใช้: ไปที่ Supabase → SQL Editor → วางโค้ดนี้ → Run
-- ============================================================

-- ── ตาราง students ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS students (
  id       BIGSERIAL    PRIMARY KEY,
  id_std   VARCHAR(50)  UNIQUE NOT NULL,
  name     VARCHAR(255) NOT NULL DEFAULT '',
  picture  TEXT         DEFAULT NULL
);

-- ── ตาราง subjects ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS subjects (
  id         BIGSERIAL    PRIMARY KEY,
  student_id BIGINT       NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  name       VARCHAR(255) NOT NULL,
  score      NUMERIC(6,2) NOT NULL DEFAULT 0
);

-- ── Index ────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_students_id_std  ON students (id_std);
CREATE INDEX IF NOT EXISTS idx_subjects_student ON subjects (student_id);

-- ── ข้อมูลตัวอย่าง ───────────────────────────────────────────
INSERT INTO students (id_std, name, picture) VALUES
  ('66010001', 'สมชาย ใจดี',      NULL),
  ('66010002', 'สมหญิง รักเรียน', NULL);

INSERT INTO subjects (student_id, name, score) VALUES
  (1, 'คณิตศาสตร์',  85),
  (1, 'ภาษาไทย',     78),
  (1, 'ภาษาอังกฤษ', 82),
  (2, 'คณิตศาสตร์',  92),
  (2, 'ภาษาไทย',     88),
  (2, 'วิทยาศาสตร์', 90);
