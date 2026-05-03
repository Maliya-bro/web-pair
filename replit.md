# MALIYA-MD

WhatsApp Pair Code and QR Code Generator.

## Project Structure
- `index.js`: Main entry point (Express server, port 5000, binds 0.0.0.0)
- `pair.js`: Router for Pair Code generation via Baileys
- `qr.js`: Router for QR Code generation via Baileys
- `mongodb.js`: MongoDB upload logic for session credentials
- `session-store.js`: In-memory store for the most recent Session ID
- `pair.html`: Frontend UI (phone number input, pairing code / QR display)
- `song.mp3`: Static asset

## Tech Stack
- Node.js >= 20 (ES Modules)
- Express.js
- @whiskeysockets/baileys (WhatsApp Web API)
- MongoDB (session persistence)
- pino (logging)

## Setup
- Port: 5000 (mapped to external port 80)
- Host: 0.0.0.0
- Workflow: "Start application" (`npm start` → `node index.js`)

## Environment Variables Required
- `MONGODB_URI`: MongoDB Atlas connection string
- `MONGODB_DB`: Database name (default: maliya_md)
- `SESSION_COLLECTION`: Collection name (default: wa_sessions)
- `PORT`: Server port (default: 5000)
