# Deploying the API (Express + Socket.IO)

This guide shows multiple ways to host the API that the Next.js app (on Vercel) will call.

Important env vars:
- PORT (default 4000)
- JWT_SECRET (set a strong secret)
- DATABASE_URL (optional, Postgres for Prisma)
- REDIS_URL (optional)
- CORS_ORIGINS (comma-separated, e.g. https://your-web.vercel.app,https://staging-your-web.vercel.app)
- ML_URL (optional, e.g. https://your-ml-service.example.com)

## 0) Database and seed (optional)
If you want DB persistence:
1. Set DATABASE_URL to a Postgres connection string.
2. Run migrations and seed:
   - npm run -w apps/api prisma:generate
   - npx -w apps/api prisma migrate deploy
   - node apps/api/prisma/seed.js

If seed fails, ensure DATABASE_URL is reachable and the schema matches. You can run:
- npx -w apps/api prisma db push   # dev only, creates tables from schema

## 1) Render.com (no Docker)
- Create a new Web Service
- Build command: (leave empty; this API has no build step)
- Start command: node src/index.js
- Environment:
  - Add PORT=4000 (Render sets PORT automatically; code reads process.env.PORT)
  - Add JWT_SECRET, DATABASE_URL, CORS_ORIGINS, ML_URL as needed
- Add a Background Worker only if you want dedicated jobs (not needed here)
- Enable a Redis add-on if using Redis and set REDIS_URL

## 2) Railway.app
- Create a New Project > Deploy from GitHub
- Select /apps/api folder as the service root, or set the service to run:
  - Start command: node src/index.js
- Add environment variables as above
- If using Postgres, add the Postgres plugin and set DATABASE_URL

## 3) Fly.io (Docker)
- Ensure apps/api/Dockerfile exists (provided)
- Install flyctl and run:
  - fly launch --now --path apps/api
- Set envs:
  - fly secrets set JWT_SECRET=... CORS_ORIGINS=https://your-web.vercel.app
  - If using Postgres, create a managed Postgres or supply external DATABASE_URL
- Exposes port 4000; set internal/external mapping as needed in fly.toml

## 4) Plain VM (Ubuntu)
- SSH into your server
- Install Node 20 and a process manager (pm2):
  - curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  - sudo apt-get install -y nodejs
  - sudo npm i -g pm2
- Clone your repo and install deps in apps/api:
  - cd apps/api && npm ci
- Set envs in a .env file (see .env.example)
- Start:
  - pm2 start src/index.js --name qsteel-api
  - pm2 save

## CORS and WebSockets
- Set CORS_ORIGINS to your Vercel domain(s): e.g. https://qsteel-web.vercel.app
- The server is already configured to allow those origins for both HTTP and Socket.IO.
- If CORS_ORIGINS is empty, the API allows all origins but disables credentials.

## Health check
- /health requires admin role; generate a demo token via /auth/login with admin@sail.test & OTP 123456, then use Authorization: Bearer <token>.

## Socket.IO endpoint
- The Socket.IO server runs on the same host/port as the API. In the web app, set
  - NEXT_PUBLIC_SOCKET_URL=https://your-api-host

## ML service (optional)
- If you deploy the Python service under services/ai (Dockerfile provided), set ML_URL to that host.
  - Example: ML_URL=https://qsteel-ml.onrender.com
- If ML_URL is not set or fails, the API returns a built-in naive forecast.
