// ===== State =====
const state = {
  token: localStorage.getItem('admin_token') || '',
  editingId: null,
  pendingPicture: null,   // dataURL when a new picture is chosen
  keepPicture: false      // whether existing picture is kept on edit
};

// ===== Helpers =====
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function setMsg(el, text, type) {
  if (!el) return;
  el.textContent = text || '';
  el.className = 'msg' + (type ? ' ' + type : '');
}

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (state.token) headers['Authorization'] = 'Bearer ' + state.token;
  const res = await fetch(path, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'เกิดข้อผิดพลาด');
  return data;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function setAvatar(container, picture, fallbackText) {
  if (picture) {
    container.innerHTML = `<img src="${escapeHtml(picture)}" alt="รูปนักเรียน" class="student-pic" />`;
  } else {
    const initial = (fallbackText || '?').trim().charAt(0).toUpperCase() || '?';
    container.innerHTML = `<div class="avatar-fallback">${escapeHtml(initial)}</div>`;
  }
}

function setLoading(btn, loading, normalText) {
  if (loading) {
    btn.dataset.label = normalText;
    btn.innerHTML = '<span class="spinner"></span>';
    btn.disabled = true;
  } else {
    btn.innerHTML = btn.dataset.label || normalText;
    btn.disabled = false;
  }
}

// ===== Tab switching =====
$$('.tab').forEach((tab) => {
  tab.addEventListener('click', () => switchView(tab.dataset.view));
});
function switchView(view) {
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === view));
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + view));
}

// ===== USER: lookup =====
$('#lookupForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('#lookupId').value.trim();
  if (!id) return;
  setMsg($('#lookupMsg'), '', '');
  $('#resultBox').classList.add('hidden');
  setLoading($('#lookupBtn'), true, 'ตรวจสอบ');
  try {
    const s = await api(`/api/student/${encodeURIComponent(id)}`);
    renderResult(s);
  } catch (err) {
    setMsg($('#lookupMsg'), err.message, 'error');
  } finally {
    setLoading($('#lookupBtn'), false, 'ตรวจสอบ');
  }
});

function renderResult(s) {
  setAvatar($('#studentAvatar'), s.picture, s.name || s.id_std);
  $('#studentName').textContent = s.name || '(ไม่ระบุชื่อ)';
  $('#studentId').textContent = 'รหัส ' + s.id_std;

  const subs = s.subjects || [];
  const total = subs.reduce((a, x) => a + (Number(x.score) || 0), 0);
  $('#statsRow').textContent = `${subs.length} วิชา · คะแนนรวม ${total}`;

  const body = $('#scoreBody');
  body.innerHTML = '';
  if (subs.length === 0) {
    body.innerHTML = '<tr class="empty"><td colspan="2">ยังไม่มีข้อมูลคะแนน</td></tr>';
  } else {
    subs.forEach((sub) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${escapeHtml(sub.name)}</td><td class="score-val">${sub.score}</td>`;
      body.appendChild(tr);
    });
  }
  $('#resultBox').classList.remove('hidden');
}

// ===== ADMIN: login =====
$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  setMsg($('#loginMsg'), '', '');
  try {
    const { token } = await api('/api/login', {
      method: 'POST',
      body: JSON.stringify({ password: $('#adminPassword').value })
    });
    state.token = token;
    localStorage.setItem('admin_token', token);
    $('#adminPassword').value = '';
    showAdminPanel();
  } catch (err) {
    setMsg($('#loginMsg'), err.message, 'error');
  }
});

$('#logoutBtn').addEventListener('click', () => {
  state.token = '';
  localStorage.removeItem('admin_token');
  $('#adminLogin').classList.remove('hidden');
  $('#adminPanel').classList.add('hidden');
});

function showAdminPanel() {
  $('#adminLogin').classList.add('hidden');
  $('#adminPanel').classList.remove('hidden');
  loadStudents();
}

// ===== ADMIN: list =====
async function loadStudents() {
  setMsg($('#adminMsg'), 'กำลังโหลดข้อมูล...', '');
  try {
    const students = await api('/api/admin/students');
    setMsg($('#adminMsg'), '', '');
    $('#adminCount').textContent = `ทั้งหมด ${students.length} คน`;
    renderStudentList(students);
  } catch (err) {
    setMsg($('#adminMsg'), err.message, 'error');
    if (/เข้าสู่ระบบ|session/.test(err.message)) {
      state.token = '';
      localStorage.removeItem('admin_token');
      $('#adminPanel').classList.add('hidden');
      $('#adminLogin').classList.remove('hidden');
    }
  }
}

function renderStudentList(students) {
  const list = $('#studentList');
  list.innerHTML = '';
  if (students.length === 0) {
    list.innerHTML = '<div class="list-empty">ยังไม่มีนักเรียนในระบบ<br>กด "+ เพิ่มนักเรียน" เพื่อเริ่ม</div>';
    return;
  }
  students.forEach((s) => {
    const nSubs = (s.subjects || []).length;
    const subs = (s.subjects || []).map((x) => x.name).join(', ') || 'ยังไม่มีวิชา';
    const div = document.createElement('div');
    div.className = 'student-item';
    div.innerHTML = `
      <div class="si-avatar" id="av-${s.id}"></div>
      <div class="info">
        <div class="si-id">${escapeHtml(s.id_std)}</div>
        <div class="si-name">${escapeHtml(s.name || '(ไม่ระบุชื่อ)')}</div>
        <div class="si-subs">${escapeHtml(subs)} · ${nSubs} วิชา</div>
      </div>
      <div class="actions">
        <button class="btn btn-ghost btn-sm" data-edit="${s.id}">แก้ไข</button>
        <button class="btn btn-danger btn-sm" data-del="${s.id}">ลบ</button>
      </div>`;
    list.appendChild(div);
    setAvatar(div.querySelector(`#av-${s.id}`), s.picture, s.name || s.id_std);
  });

  list.querySelectorAll('[data-edit]').forEach((b) =>
    b.addEventListener('click', () => openStudentForm(Number(b.dataset.edit)))
  );
  list.querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', () => deleteStudent(Number(b.dataset.del)))
  );
}

// ===== ADMIN: modal =====
$('#addBtn').addEventListener('click', () => openStudentForm(null));
$$('[data-close]').forEach((el) => el.addEventListener('click', closeModal));

$('#addSubjectBtn').addEventListener('click', () => addSubjectRow());
$('#clearPictureBtn').addEventListener('click', () => {
  state.pendingPicture = null;
  state.keepPicture = false;
  $('#formPicture').value = '';
  $('#formPicturePreview').classList.add('hidden');
  $('#formPicturePreview').src = '';
  $('#dropzoneEmpty').classList.remove('hidden');
  $('#clearPictureBtn').classList.add('hidden');
});

$('#formPicture').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    state.pendingPicture = reader.result;
    $('#formPicturePreview').src = reader.result;
    $('#formPicturePreview').classList.remove('hidden');
    $('#dropzoneEmpty').classList.add('hidden');
    state.keepPicture = false;
    $('#clearPictureBtn').classList.remove('hidden');
  };
  reader.readAsDataURL(file);
});

$('#studentForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  setMsg($('#formMsg'), 'กำลังบันทึก...', '');
  const body = {
    id_std: $('#formIdStd').value.trim(),
    name: $('#formName').value.trim(),
    subjects: collectSubjects()
  };
  if (state.pendingPicture) body.picture = state.pendingPicture;
  if (state.editingId !== null && !state.pendingPicture && !state.keepPicture) {
    body.clearPicture = true;
  }
  try {
    if (state.editingId === null) {
      await api('/api/admin/students', { method: 'POST', body: JSON.stringify(body) });
    } else {
      await api(`/api/admin/students/${state.editingId}`, { method: 'PUT', body: JSON.stringify(body) });
    }
    closeModal();
    loadStudents();
  } catch (err) {
    setMsg($('#formMsg'), err.message, 'error');
  }
});

function openStudentForm(id) {
  state.editingId = id;
  state.pendingPicture = null;
  state.keepPicture = false;
  setMsg($('#formMsg'), '', '');
  $('#studentForm').reset();
  $('#formPicturePreview').classList.add('hidden');
  $('#formPicturePreview').src = '';
  $('#dropzoneEmpty').classList.remove('hidden');
  $('#clearPictureBtn').classList.add('hidden');
  $('#subjectRows').innerHTML = '';

  if (id === null) {
    $('#modalTitle').textContent = 'เพิ่มนักเรียน';
    $('#formId').value = '';
    addSubjectRow();
  } else {
    $('#modalTitle').textContent = 'แก้ไขนักเรียน';
    api('/api/admin/students').then((students) => {
      const s = students.find((x) => x.id === id);
      if (!s) return closeModal();
      $('#formId').value = s.id_std;
      $('#formIdStd').value = s.id_std;
      $('#formName').value = s.name || '';
      if (s.picture) {
        state.keepPicture = true;
        $('#formPicturePreview').src = s.picture;
        $('#formPicturePreview').classList.remove('hidden');
        $('#dropzoneEmpty').classList.add('hidden');
        $('#clearPictureBtn').classList.remove('hidden');
      }
      (s.subjects || []).forEach((sub) => addSubjectRow(sub.name, sub.score));
      if ((s.subjects || []).length === 0) addSubjectRow();
    }).catch((err) => setMsg($('#formMsg'), err.message, 'error'));
  }
  $('#modal').classList.remove('hidden');
}

function closeModal() {
  $('#modal').classList.add('hidden');
  state.editingId = null;
  state.pendingPicture = null;
  state.keepPicture = false;
}

function addSubjectRow(name = '', score = '') {
  const row = document.createElement('div');
  row.className = 'subject-row';
  row.innerHTML = `
    <input type="text" class="name" placeholder="ชื่อวิชา" value="${escapeHtml(String(name))}" />
    <input type="number" class="score" placeholder="คะแนน" min="0" step="0.01" value="${score === '' ? '' : score}" />
    <button type="button" class="rm-btn" title="ลบวิชา" aria-label="ลบวิชา">✕</button>`;
  row.querySelector('.rm-btn').addEventListener('click', () => row.remove());
  $('#subjectRows').appendChild(row);
}

function collectSubjects() {
  const rows = $$('#subjectRows .subject-row');
  const out = [];
  rows.forEach((r) => {
    const name = r.querySelector('.name').value.trim();
    const score = r.querySelector('.score').value;
    if (name) out.push({ name, score: score === '' ? 0 : Number(score) });
  });
  return out;
}

// ===== ADMIN: delete =====
async function deleteStudent(id) {
  if (!confirm('ต้องการลบนักเรียนคนนี้ใช่หรือไม่?')) return;
  try {
    await api(`/api/admin/students/${id}`, { method: 'DELETE' });
    loadStudents();
  } catch (err) {
    setMsg($('#adminMsg'), err.message, 'error');
  }
}

// ===== Init =====
(function init() {
  if (state.token) showAdminPanel();
})();
