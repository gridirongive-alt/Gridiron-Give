# Gridiron Give

This project now includes a real backend database and API.

## Stack
- Frontend: static HTML/CSS/JS
- Backend: Node.js + Express
- Database: SQLite (`data/gridiron-give.sqlite`)

## Run Locally
1. Install dependencies:
```bash
npm install
```
2. Start server:
```bash
npm run dev
```
3. Open:
- Site: `http://localhost:3000/index.html`
- DB Admin: `http://localhost:3000/admin-db`

## Database Viewer
Use `/admin-db` to:
- view table counts
- browse rows in `coaches`, `teams`, `players`, `equipment_items`, `donations`

## Admin DB Security
Protect the admin area with env vars before deploying:
```bash
export ADMIN_ENABLED="true"
export ADMIN_FULL_USERNAME="AdminUser"
export ADMIN_FULL_PASSWORD="set-a-strong-admin-password"
export ADMIN_READONLY_USERNAME="DBmanagerUser"
export ADMIN_READONLY_PASSWORD="set-a-strong-readonly-password"
export ADMIN_SESSION_SECRET="another-long-random-secret"
```

Role access:
- `AdminUser`: full data analysis plus edit, delete, and SQL DML access
- `DBmanagerUser`: query-only access for analysis and reporting

Then access:
- Admin Login: `http://localhost:3000/admin-login`
- Admin DB: `http://localhost:3000/admin-db`

## Deploy On Render
This app is set up to deploy as one web service. The public site and Admin DB stay in the same deployment:
- Main site: `https://your-domain.com/index.html`
- Admin login: `https://your-domain.com/admin-login`
- Admin DB: `https://your-domain.com/admin-db`

Files included for deployment:
- Render config: `render.yaml`
- Persistent SQLite support: set `DATA_DIR=/var/data`

Recommended Render steps:
1. Push this project to GitHub.
2. In Render, create a new **Web Service** from the repo.
3. Render should detect `render.yaml`. If not, set:
   - Build Command: `npm install`
   - Start Command: `npm start`
4. Add a persistent disk mounted at `/var/data`.
5. Set these env vars in Render:
```bash
NODE_ENV=production
DATA_DIR=/var/data
APP_BASE_URL=https://your-real-domain.com
GMAIL_USER=your-gmail-address@gmail.com
GMAIL_APP_PASSWORD=your-gmail-app-password
ADMIN_ENABLED=true
ADMIN_FULL_USERNAME=AdminUser
ADMIN_FULL_PASSWORD=your-bcrypt-or-plain-admin-password
ADMIN_READONLY_USERNAME=DBmanageruser
ADMIN_READONLY_PASSWORD=your-bcrypt-or-plain-readonly-password
ADMIN_SESSION_SECRET=your-long-random-secret
```

Notes:
- `APP_BASE_URL` must match your live domain for recovery emails and links.
- `DATA_DIR` should point to the mounted disk so SQLite survives redeploys.
- The admin site is not a second deployment. It is just protected routes on the same app.
- For larger scale, move from SQLite to Postgres later.

## Password Recovery + Gmail
Set these environment variables before running the server:
```bash
export GMAIL_USER="your-gmail-address@gmail.com"
export GMAIL_APP_PASSWORD="your-gmail-app-password"
export APP_BASE_URL="http://localhost:3000"
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
- Existing frontend pages still use local browser storage logic.  
- Backend API + persistent DB are now available and ready for frontend migration.
- For production, this can be upgraded to managed Postgres with the same table model.
