# Archon Clipping Backend (VPS Lightweight Service)

A minimal, secure, low-memory (<30MB RAM) backend for ingesting stream clip URLs from live chat (`!clip`) and syncing with Archon CMS.

## Features
- **Zero Video Transcoding**: Handles URL and timestamp ingestion without CPU/RAM spikes.
- **Secure API Key Auth**: Authenticates Nightbot webhooks and Archon CMS frontend via secret token.
- **Atomic Storage**: Saves clips to `data/clips.json` reliably without needing heavy database servers.
- **Nightbot & BotRix Compatible**: Pre-formatted webhook responses for live chat announcements.
- **CORS Protection**: Restricted to your CMS domain.

---

## 1. Quick Setup on Your VPS

### Option A: Using Node.js & PM2 (Recommended)
```bash
# 1. Clone or copy this directory to your VPS
cd clipping-backend

# 2. Install dependencies
npm install --production

# 3. Create .env file
cp .env.example .env
nano .env  # Set your CLIPPING_API_KEY and ALLOWED_ORIGINS

# 4. Start with PM2
pm2 start server.js --name "archon-clipping"
pm2 save
pm2 startup
```

### Option B: Using Docker
```bash
docker build -t archon-clipping .
docker run -d --name archon-clipping -p 4000:4000 --env-file .env archon-clipping
```

---

## 2. Nightbot `!clip` Command Setup

In your YouTube/Twitch live chat or Nightbot Dashboard:

```text
!clip -> $(urlfetch https://your-vps-ip-or-domain.com/api/webhook/clip?secret=YOUR_CLIPPING_API_KEY&user=$(user)&url=$(querystring))
```

### How it works:
When a viewer types:
```text
!clip https://youtu.be/xyz123?t=45m20s
```
or
```text
!clip https://youtube.com/clip/Ugkx...
```

Nightbot calls your VPS backend. The backend validates the secret token, logs the clip into the CMS library, and replies in chat:
`🎬 Clip captured by @User! Saved directly to Archon CMS.`

---

## 3. Environment Variables

| Variable | Description | Example |
| :--- | :--- | :--- |
| `PORT` | Port for the HTTP server | `4000` |
| `CLIPPING_API_KEY` | Secret token required for all API calls & webhooks | `your_secret_key_123` |
| `ALLOWED_ORIGINS` | Comma-separated CORS allowed domains | `https://cms.teamarchon.in,http://localhost:3000` |

---

## 4. API Endpoints

- `GET /health`: Health check and memory usage monitor.
- `GET/POST /api/webhook/clip`: Webhook for Nightbot / BotRix.
- `GET /api/clips`: Retrieve all clips (Requires `x-api-key` header).
- `PUT /api/clips/:id`: Update clip metadata (Requires `x-api-key` header).
- `DELETE /api/clips/:id`: Delete a clip (Requires `x-api-key` header).
