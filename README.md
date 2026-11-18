# Chatz

A full-stack real-time chat web app using:
- React + Vite frontend
- Node.js + Express backend
- Socket.IO for real-time messaging
- MongoDB with Mongoose
- JWT authentication

## 1) Setup

### Backend
1. Copy `server/.env.example` to `server/.env`
2. Set `MONGODB_URI` to a complete MongoDB/Atlas connection string and set `JWT_SECRET`
3. On Render, update `MONGODB_URI` in the service Environment settings, then redeploy
4. For MongoDB Atlas, allow Render's network or use a valid Atlas access configuration

### Frontend
1. Copy `client/.env.example` to `client/.env`
2. Adjust URLs if needed

## 2) Install dependencies

From the project root:

```bash
npm install
npm install --prefix server
npm install --prefix client
```

## 3) Run in development

```bash
npm run dev
```

- Backend: `http://localhost:5000`
- Frontend: `http://localhost:5173`

## API Overview

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me` (Bearer token)
- `GET /api/messages`
- `GET /api/health`

## Socket Events

Client to server:
- `chat_message` with `{ content: string }`

Server to client:
- `new_message`
- `online_users`
