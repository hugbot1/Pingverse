# Pingverse

A real-time chat platform made of two independent services:

- **`api/`** - API server: auth, chat (Socket.IO) and the admin API, backed by a
  **local SQLite file** (Node's built-in `node:sqlite`, no native build step).
- **`web/`** - Vue frontend powered by Nuxt, with routes for sign-in, chat, and admin.

```
Pingverse/
├── api/
│   ├── scripts/set-role.js
│   ├── src/ (API routes, SQLite models, and Socket.IO handlers)
│   └── data/pingverse.db
└── web/
    ├── app/
    │   ├── pages/ (sign-in, chat, and admin routes)
    │   ├── components/ (chat, messages, emoji, voice, and sign-in UI)
    │   └── composables/ (API access)
    ├── public/ (existing CSS and static assets)
    ├── server/ (security headers)
    └── nuxt.config.ts
```

## Requirements

Node.js **22.5 or newer** for both folders (`node -v`).

## Setup

```bash
# 1) API
cd api
npm install
cp .env.example .env        # then edit .env (set JWT_SECRET, see the file)
npm start

# 2) Web (second terminal)
cd web
npm install
cp .env.example .env
npm run dev
```

Open http://localhost:3000. In web/, 'npm start' is a dev-server alias. For production, run 'npm run build' then 'npm run serve'.

## Accounts, approval and admins

There are no access keys or admin keys any more.

1. **Anyone can request an account** on the Register tab. The account is created
   as `pending` and cannot sign in.
2. **An admin approves (or rejects) it** in the Admin Panel. Only approved
   accounts can sign in, connect to chat, or appear in the user list.
3. **Admins are set manually in the database.** Nothing in the web app can grant
   or remove the admin role. To create your first admin, register normally, then
   on the machine running the API:

   ```bash
   cd api
   npm run set-role -- yourname admin     # also marks the account approved
   npm run set-role -- yourname user      # demote again
   ```

   (Equivalent SQL: `UPDATE users SET role='admin', status='approved' WHERE username='yourname';`)

Role and approval are read from the database on every request, so a demotion or
deletion takes effect immediately, even for people who are already signed in.
Databases created before this version are migrated automatically: existing
accounts are kept and marked approved.

## The admin panel (`/admin`)

Every owner/admin action is in this one page and its API (`/admin/*`):

- approve / reject pending sign-ups
- timeout / end timeout / delete users
- publish or remove the announcement banner
- delete individual global messages, or erase the whole global chat
- audit log of everything above

The chat page has no admin controls (it only shows an "Admin Panel" button to
admins). Regular chat is now strictly self-service: you can edit/delete only your
own messages and delete only your own account.

Security properties of the admin API:

- requires a valid session whose account is *currently* an approved admin
  (checked in the database each request; the frontend check is cosmetic)
- every state-changing call must carry an `Origin` header exactly matching
  `CLIENT_URL`, on top of the httpOnly SameSite cookie
- rate limited, input validated (Zod), and audit-logged
- admin accounts cannot be timed out, deleted or otherwise modified from the
  panel, and cannot delete themselves from the app
- private messages (DMs) can't be viewed or moderated from the panel

## Other security notes

httpOnly session cookie (no token in JS), CORS + Origin checks, strict CSP with no
inline scripts/styles, Zod validation on every REST body and socket event, bcrypt
cost 12, login timing equalised for unknown usernames, rate limiting on auth,
a cap of 100 pending sign-ups, and the username `global` is reserved.

## Deploying

- Serve the API over HTTPS and set `COOKIE_SECURE=true`.
- Different registrable domains for web and API: set `COOKIE_SAMESITE=none`
  (requires `COOKIE_SECURE=true`).
- Behind a reverse proxy: `TRUST_PROXY=true`.
- Set `web/.env` `API_URL` and `api/.env` `CLIENT_URL` to the real public URLs.
- Back up `api/data/pingverse.db` (it is the whole database).
