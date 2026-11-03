# Archon YouTube Clipping Backend (VPS Service)

A dedicated, lightweight, high-performance service for capturing live stream clips via chat commands (`!clip`) or CMS Studio controls, designed to be deployed separately on your VPS.

---

## 1. Features
- **YouTube Live Auto-Resolution**: Resolves `@channel` live streams dynamically.
- **Nightbot / Chatbot Webhook**: `!clip` command returns instant clip links directly in live chat.
- **Interactive Embeds + Static MP4s**: Supports instant embeds and local MP4 streaming with byte-range requests.
- **Zero Heavy Setup**: Uses atomic file storage (`data/clips.json`); no complex database maintenance required.
- **Secured API**: CORS protection and API key authorization for CMS management.

---

## 2. Quick Deploy to Your VPS

### Option A: Using PM2 (Recommended)
```bash
# 1. Copy the clipping-backend folder to your VPS
cd clipping-backend

# 2. Install dependencies
npm install --production

# 3. Create .env
cp .env.example .env
nano .env

# 4. Start with PM2
pm2 start server.js --name "archon-clipping"
pm2 save
pm2 startup
```

### Option B: Using Docker
```bash
docker build -t archon-clipping .
docker run -d --restart always --name archon-clipping -p 4000:4000 --env-file .env -v $(pwd)/data:/app/data archon-clipping
```

---

## 3. Nightbot / StreamElements Setup

In YouTube Live Chat or your Nightbot Dashboard:

### The Chat Command:
Add a command named `!clip`:
```text
!clip -> $(urlfetch https://your-vps-domain.com/api/webhook/youtube?channel=@YourChannelHandle&user=$(user)&title=$(querystring))
```

### Example in Chat:
When a viewer types:
```text
!clip Insane 1v3 Clutch
```
Nightbot automatically calls your VPS. The VPS records the active live stream moment and replies in chat:
```text
🎬 Clip captured by @ViewerName! Watch: https://cms.teamarchon.in/clip/yt_174000000000_abcd
```

---

## 4. API Endpoints

| Method | Endpoint | Description | Auth Required |
| :--- | :--- | :--- | :--- |
| `GET` | `/health` | VPS Health and memory monitor | No |
| `GET/POST`| `/api/webhook/youtube` | Chatbot clipping webhook | No (rate-limited) |
| `POST` | `/api/youtube/capture` | CMS Studio manual clip trigger | Yes (`x-api-key`) |
| `GET` | `/api/public/clip/:id` | Fetch public clip metadata | No |
| `GET` | `/clips/:id.mp4` | Direct MP4 stream | No |
| `GET` | `/api/clips` | List all clips in CMS | Yes (`x-api-key`) |
| `PUT` | `/api/clips/:id` | Update / trim clip | Yes (`x-api-key`) |
| `DELETE` | `/api/clips/:id` | Delete clip | Yes (`x-api-key`) |
