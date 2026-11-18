# ระบบตรวจสอบคะแนน

เว็บแอปตรวจสอบคะแนนนักเรียน ฝั่งผู้ใช้กรอก ID STD ดูคะแนนรายวิชา ฝั่ง Admin เพิ่ม/แก้ไข/ลบ ข้อมูลนักเรียน พร้อมรูปภาพ ใช้ SQLite built-in Node.js (ไม่ต้องติดตั้ง database แยก)

## Stack

- **Backend:** Node.js (>=22.5) + Express 4.22
- **Database:** SQLite ผ่าน `node:sqlite` (built-in)
- **Frontend:** Vanilla HTML/CSS/JS (Liquid Glass theme)

## วิธีรันในเครื่อง

```bash
npm install
npm start
```

เปิดเบราว์เซอร์ที่ <http://localhost:3000>

รหัสผ่าน Admin เริ่มต้น: `admin123`

## Deploy บน Render.com (แนะนำ)

1. Push โค้ดขึ้น GitHub
2. ไปที่ [render.com](https://render.com) → **New Web Service** → เลือก repo
3. ตั้งค่า:
   - **Environment:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Node Version:** `22`
4. เพิ่ม Environment Variables:
   - `ADMIN_PASSWORD` = รหัสผ่านที่ต้องการ
   - `NODE_ENV` = `production`
5. กด **Deploy**

> ⚠️ Render Free tier จะ sleep เมื่อไม่มีผู้ใช้ 15 นาที ถ้าต้องการไม่ sleep ใช้ Paid tier

## Deploy บน Railway.app

1. Push โค้ดขึ้น GitHub
2. ไปที่ [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub**
3. เลือก repo แล้ว Railway จะ detect Node.js อัตโนมัติ
4. เพิ่ม Variables: `ADMIN_PASSWORD`, `NODE_ENV=production`
5. กด **Deploy**

## Environment Variables

| Variable | Default | ความหมาย |
|---|---|---|
| `PORT` | `3000` | port ที่เซิร์ฟเวอร์จะฟัง (platform ตั้งให้อัตโนมัติ) |
| `ADMIN_PASSWORD` | `admin123` | รหัสผ่าน Admin — **เปลี่ยนก่อน deploy จริง** |
| `NODE_ENV` | — | ตั้งเป็น `production` เพื่อเปิด cache headers |

## โครงสร้างโปรเจกต์

```
STD_Score/
├── server.js          # Express API
├── package.json
├── Procfile           # สำหรับ Heroku/Render
├── .gitignore
├── .env.example
├── data/
│   └── scores.db      # SQLite (auto-created, gitignored)
├── uploads/           # รูปภาพ (auto-created, gitignored)
├── public/            # Frontend (เว็บหลัก)
│   ├── index.html
│   ├── css/style.css
│   └── js/app.js
└── index.html         # Standalone preview (ไม่ต้องรัน server)
```

## หมายเหตุ

- `index.html` ที่ root คือไฟล์ preview แบบ standalone ดับเบิ้ลคลิกเปิดได้เลย (ใช้ mock data)
- ไฟล์จริงที่ server serve อยู่ใน `public/`
- รูปภาพและ database ถูก gitignore ไว้ ต้อง backup แยกถ้าต้องการ
