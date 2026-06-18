# Gridiron Give

This project now includes a real backend database and API.

## Stack
- Frontend: static HTML/CSS/JS
- Backend: Node.js + Express
- Database: Postgres via `DATABASE_URL`

## Run Locally
1. Install dependencies:
```bash
npm install
```
2. Start server:
```bash
export DATABASE_URL="postgresql://USER:PASSWORD@HOST:PORT/DATABASE?sslmode=require"
npm run dev
```
3. Open:
- Site: `http://localhost:3000/index.html`

## Deploy On Render
This app is set up to deploy as one web service:
- Main site: `https://your-domain.com/index.html`

Files included for deployment:
- Render config: `render.yaml`
- Optional backup-file disk: set `DATA_DIR=/var/data`

Recommended Render steps:
1. Push this project to GitHub.
2. In Render, create a new **Web Service** from the repo.
3. Render should detect `render.yaml`. If not, set:
   - Build Command: `npm install`
   - Start Command: `npm start`
4. Set these env vars in Render:
```bash
NODE_ENV=production
DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/DATABASE?sslmode=require
APP_BASE_URL=https://your-real-domain.com
GMAIL_USER=your-gmail-address@gmail.com
GMAIL_APP_PASSWORD=your-gmail-app-password
STRIPE_SECRET_KEY=sk_live_or_test_key
STRIPE_WEBHOOK_SECRET=whsec_...
```

Notes:
- `APP_BASE_URL` must match your live domain for recovery emails and links.
- `DATABASE_URL` is required. The app no longer falls back to SQLite.
- Use the external Postgres URL for Render unless your database provider gives Render an internal network URL.
- Daily JSON and Excel backups are still written under `DATA_DIR` when that variable is set.

## Password Recovery + Gmail
Set these environment variables before running the server:
```bash
export GMAIL_USER="your-gmail-address@gmail.com"
export GMAIL_APP_PASSWORD="your-gmail-app-password"
export APP_BASE_URL="http://localhost:3000"
export DATABASE_URL="postgresql://USER:PASSWORD@HOST:PORT/DATABASE?sslmode=require"
```

Then run:
```bash
npm run dev
```

Notes:
- Passwords are stored as bcrypt hashes.
- Coaches and players each have a `PW_Recovery_Key` column in DB.
- Never hardcode app passwords in source files.

## Notes
- Backend API + Postgres persistence are required for the app to run.
- The old employee database UI has been removed.
