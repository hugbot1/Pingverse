# Pingverse

## Requirements

Node.js **22.5 or newer** for both folders (`node -v`).

## Setup

```bash
# 1) API
cd api
npm install
cp .env.example .env
npm start

# 2) Web
cd web
npm install
cp .env.example .env
npm run dev
```

Open http://localhost:3000. In web/, 'npm start' is a dev-server alias. For production, run 'npm run build' then 'npm run serve'.

## Useful
npm run set-role -- yourname admin
npm run set-role -- yourname user

## Deploying

- Serve the API over HTTPS and set `COOKIE_SECURE=true`.
- Different registrable domains for web and API: set `COOKIE_SAMESITE=none`
- Behind a reverse proxy: `TRUST_PROXY=true`.
- Set `web/.env` `API_URL` and `api/.env` `CLIENT_URL`.