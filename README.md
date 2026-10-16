# Pingverse

## Setup

```bash
API
cd api
npm install
cp .env.example .env
npm start

Web
cd web
npm install
cp .env.example .env
npm run dev
```

## thing
prod: 
COOKIE_SECURE=true
different domains for web and api: COOKIE_SAMESITE=none
if behind a reverse proxy: TRUST_PROXY=true
api: npm start
web: npm run serve
