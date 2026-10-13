# 🚀 Daily Cash Book & Financial Management — Deployment on Vercel & 1:00 AM Database Backup

This project is fully configured for zero-configuration, 1-click deployment on [Vercel](https://vercel.com).

---

## 🗄️ 1. Database Architecture & Setup

The application features a hybrid persistent database layer:
1. **Serverless PostgreSQL (Recommended)**: Connect to **Neon Postgres**, **Vercel Postgres**, **Supabase**, or **Railway**.
2. **Local / Serverless In-Memory & File Fallback**: Works out-of-the-box even without external DB credentials.

### Connecting Your Cloud Database on Vercel:
In your **Vercel Project Settings ➔ Environment Variables**, add:
- `DATABASE_URL` (or `POSTGRES_URL`):
  ```bash
  postgresql://[user]:[password]@[host]:5432/[database]?sslmode=require
  ```
The database schema (`roznamcha_state` and `roznamcha_backups`) creates itself automatically on startup!

---

## ⏰ 2. Automated Nightly 1:00 AM Database Backup

The project includes an automated cron schedule in [`vercel.json`](file:///c:/Antigravity%20Project/vercel.json):
```json
{
  "crons": [
    {
      "path": "/api/backup?auto=true",
      "schedule": "0 20 * * *"
    }
  ]
}
```
- **Timezone Conversion**: `0 20 * * *` is **20:00 UTC**, which corresponds exactly to **01:00 AM Pakistan Time (PKT)** every night.
- **What it does**:
  1. Creates an encrypted snapshot dump of all daily entries, vendor payments, customer Udhaar records, and calculations.
  2. Stores snapshots in the database backup table (`roznamcha_backups`) and rolling snapshot storage.
  3. Provides **1-Click Restore** and **Download Snapshot JSON** directly inside the Admin Backend.

---

## 🚀 3. How to Deploy on Vercel

### Method A: Deploy via GitHub (Recommended)
1. Initialize git and push this folder to your GitHub repository:
   ```bash
   git init
   git add .
   git commit -m "Roznamcha Cash Book with 1AM DB Backup & Vercel deployment"
   git remote add origin https://github.com/YOUR_USERNAME/roznamcha-cashbook.git
   git push -u origin main
   ```
2. Open [vercel.com](https://vercel.com) and click **"Add New Project"**.
3. Import your repository and click **Deploy**.
4. (Optional) In project settings, add the `DATABASE_URL` environment variable under **Storage** or **Environment Variables**.

---

### Method B: Deploy via Vercel CLI
Run the following in your terminal:
```bash
cmd.exe /c "npx vercel"
```
Follow the interactive prompts to deploy in seconds!

---

## 💻 4. Running Locally

To test locally with the Node serverless runtime:
```bash
cmd.exe /c "npm start"
```
Open [http://localhost:3000](http://localhost:3000) in your browser.
