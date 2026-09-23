# SkillForge Studio

A Node.js, Express, SQLite, and Socket.IO site for practical skills, learning guides, free resources, contact messages, and anonymous live visitor analytics.

## Run locally

1. Install Node.js 20 or newer.
2. Run `npm install`.
3. Copy `.env.example` to `.env` and set a unique admin password and session secret.
4. Run `npm start`.
5. Open `http://localhost:3000`; the private dashboard is at `/admin`.

The app creates its SQLite schema and starter content at startup. The admin account is created from `ADMIN_EMAIL` and `ADMIN_PASSWORD`. In production, all three values `ADMIN_EMAIL`, `ADMIN_PASSWORD`, and `SESSION_SECRET` are required.

## Railway

Set `PORT=3000`, `NODE_ENV=production`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `SESSION_SECRET`, and `DB_PATH=/data/site.db`. Mount a persistent volume at `/data` so guides, resources, visitor analytics, contact messages, and sessions survive deployments. Set the healthcheck path to `/api/health` and route the Railway domain to port 3000.

The health route checks that SQLite is responding. Session data is stored in SQLite rather than process memory, so sign-ins remain valid across app restarts.

## Included

- Responsive public home page and resource/guide library
- Password-hashed admin login with session rotation and SQLite-backed sessions
- Dashboard analytics, current anonymous visitors, popular pages, and contact inbox
- Create and delete workflows for guides and resources
- Validated contact submissions and login/message rate limits
- SQLite health checks and safe visitor cookies
