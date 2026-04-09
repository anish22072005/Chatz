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
2. Fill in `MONGODB_URI` and `JWT_SECRET`

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
