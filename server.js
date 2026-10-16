/**
 * Archon CMS - Lightweight Independent Clipping Backend
 * Optimized for low-memory VPS (<500MB RAM)
 * Features:
 *  - Secure API Key token verification (Header & Query secret)
 *  - CORS restricted to Archon CMS
 *  - Nightbot / Chatbot $(urlfetch) webhook
 *  - YouTube / Twitch / Kick URL and timestamp parser
 *  - Zero-transcoding, persistent atomic JSON storage
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 4000;
const API_KEY = process.env.CLIPPING_API_KEY || 'archon_secret_clip_token_2026';
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'clips.json');

// Ensure data directory and storage file exist
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, JSON.stringify([], null, 2), 'utf-8');
}

// Memory-friendly database helpers
function readClips() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('[Storage] Error reading clips:', err.message);
    return [];
  }
}

function writeClips(clips) {
  try {
    // Atomic write via temp file
    const tempFile = `${DATA_FILE}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(clips, null, 2), 'utf-8');
    fs.renameSync(tempFile, DATA_FILE);
  } catch (err) {
    console.error('[Storage] Error saving clips:', err.message);
  }
}

// CORS Configuration
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'https://cms.teamarchon.in,http://localhost:3000,http://localhost:5173')
  .split(',')
  .map(o => o.trim());

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like Nightbot or server-to-server) or matching allowed origins
    if (!origin || allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
      return callback(null, true);
    }
    return callback(new Error('Blocked by CORS policy'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
}));

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate Limiting (in-memory sliding window)
const rateLimitMap = new Map();
function rateLimiter(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const now = Date.now();
  const windowMs = 60 * 1000; // 1 minute
  const maxRequests = 15; // Max 15 clips per minute per IP

  const clientData = rateLimitMap.get(ip) || { count: 0, resetTime: now + windowMs };
  if (now > clientData.resetTime) {
    clientData.count = 1;
    clientData.resetTime = now + windowMs;
  } else {
    clientData.count++;
  }
  rateLimitMap.set(ip, clientData);

  if (clientData.count > maxRequests) {
    return res.status(429).send('Rate limit exceeded. Please wait a minute before clipping again.');
  }
  next();
}

// Security Middleware: Verify API Key
function authenticateApiKey(req, res, next) {
  const token = 
    req.headers['x-api-key'] || 
    req.query.secret || 
    req.headers.authorization?.replace(/^Bearer\s+/i, '');

  if (!token || token !== API_KEY) {
    return res.status(401).json({ error: 'Unauthorized: Invalid or missing API key' });
  }
  next();
}

// Helper: Parse video URLs and timestamps
function parseVideoUrl(rawUrl) {
  if (!rawUrl) return null;
  const cleanUrl = rawUrl.trim();

  // YouTube timestamp & video ID parsing
  // Matches: youtu.be/ID, youtube.com/watch?v=ID, youtube.com/clip/CLIP_ID
  const ytMatch = cleanUrl.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|shorts\/))([\w-]{11})/i);
  const ytClipMatch = cleanUrl.match(/youtube\.com\/clip\/([\w-]+)/i);

  let platform = 'upload';
  let videoId = '';
  let timestampSeconds = 0;
  let thumbnailUrl = '';

  if (ytMatch) {
    platform = 'youtube';
    videoId = ytMatch[1];
    thumbnailUrl = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;

    // Parse ?t=1h2m3s or ?t=123
    const tParam = cleanUrl.match(/[?&]t=(\d+h)?(\d+m)?(\d+s?|\d+)/i);
    if (tParam) {
      let total = 0;
      if (tParam[1]) total += parseInt(tParam[1]) * 3600;
      if (tParam[2]) total += parseInt(tParam[2]) * 60;
      if (tParam[3]) total += parseInt(tParam[3].replace('s', ''));
      timestampSeconds = total;
    }
  } else if (ytClipMatch) {
    platform = 'youtube';
    videoId = ytClipMatch[1];
    thumbnailUrl = 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=800&auto=format&fit=crop&q=80';
  } else if (/twitch\.tv/i.test(cleanUrl)) {
    platform = 'twitch';
    thumbnailUrl = 'https://images.unsplash.com/photo-1511512578047-dfb367046420?w=800&auto=format&fit=crop&q=80';
  } else if (/kick\.com/i.test(cleanUrl)) {
    platform = 'kick';
    thumbnailUrl = 'https://images.unsplash.com/photo-1538481199705-c710c4e965fc?w=800&auto=format&fit=crop&q=80';
  } else {
    thumbnailUrl = 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=800&auto=format&fit=crop&q=80';
  }

  return {
    platform,
    videoId,
    timestampSeconds,
    thumbnailUrl,
    originalUrl: cleanUrl
  };
}

// ============================================================
// ROUTES
// ============================================================

// 1. Health & VPS Resource Monitor
app.get('/health', (req, res) => {
  const memUsage = process.memoryUsage();
  res.json({
    status: 'online',
    service: 'archon-clipping-backend',
    uptimeSeconds: Math.floor(process.uptime()),
    ramUsedMB: (memUsage.rss / 1024 / 1024).toFixed(2),
    heapUsedMB: (memUsage.heapUsed / 1024 / 1024).toFixed(2),
    totalClips: readClips().length,
    timestamp: new Date().toISOString()
  });
});

// 2. Chatbot Webhook: Nightbot / BotRix / Streamlabs (!clip)
// Supports GET and POST for Nightbot $(urlfetch)
app.all('/api/webhook/clip', rateLimiter, authenticateApiKey, (req, res) => {
  const rawUrl = req.query.url || req.body?.url;
  const user = req.query.user || req.body?.user || 'Viewer';
  const customTitle = req.query.title || req.body?.title;
  const channel = req.query.channel || 'Team Archon';

  if (!rawUrl) {
    return res.status(400).send('Error: Missing video/clip URL. Usage: !clip <url>');
  }

  const parsed = parseVideoUrl(rawUrl);
  if (!parsed) {
    return res.status(400).send('Error: Invalid URL format.');
  }

  const duration = 30; // standard 30s clip window
  const startTime = parsed.timestampSeconds > 0 ? Math.max(0, parsed.timestampSeconds - duration) : 0;
  const endTime = parsed.timestampSeconds > 0 ? parsed.timestampSeconds : duration;

  const newClip = {
    id: `clip_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    title: customTitle || `Stream Clip by @${user} (${parsed.platform.toUpperCase()})`,
    sourcePlatform: parsed.platform,
    sourceUrl: parsed.originalUrl,
    videoUrl: parsed.originalUrl,
    thumbnailUrl: parsed.thumbnailUrl,
    duration,
    startTime,
    endTime,
    aspectRatio: '9:16',
    status: 'ready',
    viralScore: Math.floor(Math.random() * 15) + 85,
    tags: [parsed.platform, 'streamclip', 'chat_clip'],
    streamer: channel,
    game: 'Live Stream',
    views: 1,
    aiHookText: `INSANE MOMENT CLIPPED BY @${user.toUpperCase()} 🔥`,
    clippedBy: user,
    createdAt: new Date().toISOString()
  };

  const clips = readClips();
  clips.unshift(newClip);
  writeClips(clips);

  // Return clean plain text response for Nightbot chat
  const isJson = req.headers.accept?.includes('application/json');
  if (isJson) {
    return res.json({ success: true, clip: newClip });
  }

  // Friendly Nightbot response
  return res.send(`🎬 Clip captured by @${user}! Saved directly to Archon CMS.`);
});

// 3. CMS API: List all clips (Secured)
app.get('/api/clips', authenticateApiKey, (req, res) => {
  const clips = readClips();
  res.json({ success: true, count: clips.length, clips });
});

// 4. CMS API: Create clip manually (Secured)
app.post('/api/clips', authenticateApiKey, (req, res) => {
  const clipData = req.body;
  if (!clipData || !clipData.title) {
    return res.status(400).json({ error: 'Missing clip data or title' });
  }

  const newClip = {
    id: `clip_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    createdAt: new Date().toISOString(),
    ...clipData
  };

  const clips = readClips();
  clips.unshift(newClip);
  writeClips(clips);

  res.status(201).json({ success: true, clip: newClip });
});

// 5. CMS API: Update clip (Secured)
app.put('/api/clips/:id', authenticateApiKey, (req, res) => {
  const { id } = req.params;
  const updates = req.body;
  const clips = readClips();

  const idx = clips.findIndex(c => c.id === id);
  if (idx === -1) {
    return res.status(404).json({ error: 'Clip not found' });
  }

  clips[idx] = { ...clips[idx], ...updates, updatedAt: new Date().toISOString() };
  writeClips(clips);

  res.json({ success: true, clip: clips[idx] });
});

// 6. CMS API: Delete clip (Secured)
app.delete('/api/clips/:id', authenticateApiKey, (req, res) => {
  const { id } = req.params;
  const clips = readClips();
  const filtered = clips.filter(c => c.id !== id);

  if (filtered.length === clips.length) {
    return res.status(404).json({ error: 'Clip not found' });
  }

  writeClips(filtered);
  res.json({ success: true, message: 'Clip deleted successfully' });
});

// Start Server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`===============================================`);
  console.log(` Archon Clipping Backend running on port ${PORT}`);
  console.log(` Webhook URL: /api/webhook/clip`);
  console.log(` API Endpoint: /api/clips`);
  console.log(` Security: API Key authorization active`);
  console.log(`===============================================`);
});
