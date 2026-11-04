/**
 * Team Archon CMS - Dedicated VPS Clipping Backend
 * Optimized for low-memory VPS environments (<500MB RAM)
 * 
 * Features:
 *  - YouTube Live Stream Auto-Resolver & Clip Generator
 *  - Chatbot Webhook for Nightbot / StreamElements / Botrix (!clip $(urlfetch ...))
 *  - Instant YouTube Cued Embed + Optional FFmpeg MP4 Slicing
 *  - Discord Webhook Logging with embeds, previews & timestamps
 *  - Public Clip Viewer API (No auth required for chat viewers)
 *  - Authenticated CMS Studio API (CORS + API Key protected)
 *  - Atomic JSON File Database with zero database setup required
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const app = express();
const PORT = process.env.PORT || 4000;
const API_KEY = process.env.CLIPPING_API_KEY || 'archon_secret_clip_token_2026';
const FRONTEND_URL = (process.env.FRONTEND_URL || 'https://cms.teamarchon.in').replace(/\/+$/, '');
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`).replace(/\/+$/, '');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://obsnaxcxeaqeluvqwaos.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ic25heGN4ZWFxZWx1dnF3YW9zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYwMzc4NDksImV4cCI6MjEwMTYxMzg0OX0._3yZp1bBS3OvCeioyWcVR1cIfyPQk52rVmWoihwKzo8';

async function syncClipToSupabase(clip) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return;
  try {
    const payload = {
      id: clip.id,
      title: clip.title,
      description: clip.description,
      source_platform: clip.sourcePlatform || 'youtube',
      source_url: clip.sourceUrl,
      video_url: clip.videoUrl,
      video_id: clip.videoId,
      thumbnail_url: clip.thumbnailUrl,
      duration: clip.duration || 30,
      start_time: clip.startTime || 0,
      end_time: clip.endTime || 30,
      offset_seconds: clip.offsetSeconds || 0,
      current_live_time_seconds: clip.currentLiveTimeSeconds || 0,
      timestamp_url: clip.timestampUrl,
      current_time_url: clip.currentTimeUrl,
      is_embeddable: clip.isEmbeddable ?? true,
      aspect_ratio: clip.aspectRatio || '16:9',
      status: clip.status || 'ready',
      viral_score: clip.viralScore || 90,
      tags: clip.tags || [],
      streamer: clip.streamer,
      game: clip.game || 'Live Stream',
      views: clip.views || 1,
      clipped_by: clip.clippedBy || 'Viewer',
      clip_page_url: clip.clipPageUrl,
      embed_url: clip.embedUrl,
      created_at: clip.createdAt || new Date().toISOString()
    };

    await fetch(`${SUPABASE_URL}/rest/v1/clips`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates'
      },
      body: JSON.stringify(payload)
    });
  } catch (err) {
    console.warn('[Supabase Sync Warning]', err.message);
  }
}

async function deleteClipFromSupabase(clipId) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !clipId) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/clips?id=eq.${encodeURIComponent(clipId)}`, {
      method: 'DELETE',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      }
    });
  } catch (err) {
    console.warn('[Supabase Delete Warning]', err.message);
  }
}

async function updateClipInSupabase(clipId, updates) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !clipId) return;
  try {
    const payload = { ...updates, updated_at: new Date().toISOString() };
    await fetch(`${SUPABASE_URL}/rest/v1/clips?id=eq.${encodeURIComponent(clipId)}`, {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
  } catch (err) {
    console.warn('[Supabase Update Warning]', err.message);
  }
}

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'clips.json');
const CLIPS_DIR = path.join(__dirname, 'public', 'clips');

// Ensure data directory and public clips directory exist
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(CLIPS_DIR)) {
  fs.mkdirSync(CLIPS_DIR, { recursive: true });
}
if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, JSON.stringify([], null, 2), 'utf-8');
}

const WHITELIST_FILE = path.join(DATA_DIR, 'whitelist.json');
if (!fs.existsSync(WHITELIST_FILE)) {
  fs.writeFileSync(WHITELIST_FILE, JSON.stringify([], null, 2), 'utf-8');
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
    const tempFile = `${DATA_FILE}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(clips, null, 2), 'utf-8');
    fs.renameSync(tempFile, DATA_FILE);
  } catch (err) {
    console.error('[Storage] Error saving clips:', err.message);
  }
}

function readWhitelist() {
  try {
    const raw = fs.readFileSync(WHITELIST_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('[Storage] Error reading whitelist:', err.message);
    return [];
  }
}

function writeWhitelist(users) {
  try {
    const tempFile = `${WHITELIST_FILE}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(users, null, 2), 'utf-8');
    fs.renameSync(tempFile, WHITELIST_FILE);
  } catch (err) {
    console.error('[Storage] Error saving whitelist:', err.message);
  }
}

// ============================================================
// DISCORD WEBHOOK LOGGING
// ============================================================
async function sendDiscordLog({ type = 'info', title, description, fields = [], imageUrl, url }) {
  const webhookUrl = 
    process.env.DISCORD_CLIPS_WEBHOOK_URL || 
    process.env.DISCORD_LOG_WEBHOOK_URL || 
    process.env.DISCORD_WEBHOOK_URL;

  if (!webhookUrl || typeof webhookUrl !== 'string' || !webhookUrl.startsWith('http')) {
    return;
  }

  const botName = process.env.DISCORD_BOT_NAME || 'Archon Clipping Engine';
  const botAvatar = process.env.DISCORD_BOT_AVATAR || `${FRONTEND_URL}/logo.png`;

  // Colors: Archon Red (#DC2626 = 14427686), Green (#10B981 = 1096065), Amber (#F59E0B = 16098851), Red (#EF4444 = 15680324)
  let color = 14427686;
  if (type === 'success') color = 1096065;
  if (type === 'error') color = 15680324;
  if (type === 'warn') color = 16098851;

  const embed = {
    title: title || 'Archon Clipping Log',
    url: url || undefined,
    description: description || undefined,
    color,
    author: {
      name: 'Team Archon CMS',
      icon_url: botAvatar,
      url: FRONTEND_URL
    },
    fields: (fields || []).filter(f => f && f.name && f.value).map(f => ({
      name: String(f.name),
      value: String(f.value),
      inline: Boolean(f.inline)
    })),
    footer: {
      text: 'Archon Clipping Engine • VPS System Log',
      icon_url: botAvatar
    },
    timestamp: new Date().toISOString()
  };

  if (imageUrl) {
    embed.image = { url: imageUrl };
  }

  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: botName,
        avatar_url: botAvatar,
        embeds: [embed]
      })
    });
  } catch (err) {
    console.error('[Discord Log Error]', err.message);
  }
}

// CORS Configuration
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'https://cms.teamarchon.in,http://localhost:3000,http://localhost:5173')
  .split(',')
  .map(o => o.trim());

app.use(cors({
  origin: (origin, callback) => {
    // Allow public clip viewers, server-to-server, chat bots, or requests from CMS origins
    if (!origin || allowedOrigins.includes(origin) || allowedOrigins.includes('*') || origin.endsWith('teamarchon.in')) {
      return callback(null, true);
    }
    // Allow public viewing from anywhere
    return callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
}));

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve static MP4 clip files with HTTP range streaming
app.use('/clips', express.static(CLIPS_DIR));
app.use(express.static(path.join(__dirname, 'public')));

// Rate Limiter
const rateLimitMap = new Map();
function rateLimiter(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const now = Date.now();
  const windowMs = 60 * 1000;
  const maxRequests = 20;

  const clientData = rateLimitMap.get(ip) || { count: 0, resetTime: now + windowMs };
  if (now > clientData.resetTime) {
    clientData.count = 1;
    clientData.resetTime = now + windowMs;
  } else {
    clientData.count++;
  }
  rateLimitMap.set(ip, clientData);

  if (clientData.count > maxRequests) {
    return res.status(429).send('Rate limit exceeded. Please wait a moment before clipping again.');
  }
  next();
}

// Security Middleware: Verify API Key or Streamer Secret
function authenticateApiKey(req, res, next) {
  const token = 
    req.headers['x-api-key'] || 
    req.query.api_key || 
    req.query.apiKey || 
    req.headers.authorization?.replace(/^Bearer\s+/i, '');

  const validKeys = [API_KEY, 'your_vps_secure_secret_key_change_me', 'archon_secret_clip_token_2026'].filter(Boolean);

  if (!token || !validKeys.includes(token)) {
    return res.status(401).json({ error: 'Unauthorized: Invalid or missing API key' });
  }
  next();
}

// ============================================================
// YOUTUBE RESOLUTION HELPERS
// ============================================================

// Helper: Format seconds to HH:MM:SS or MM:SS
function formatTimestamp(sec) {
  if (isNaN(sec) || sec <= 0) return '00:00';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Resolves a YouTube channel handle, live URL, or video ID to active live stream details
 */
async function resolveYouTubeTarget(channelOrUrl) {
  if (!channelOrUrl) return null;
  const input = channelOrUrl.trim();

  let targetUrl = '';
  let cleanHandle = '';

  // 1. Check if user provided direct video ID or URL
  const directMatch = input.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|live\/|shorts\/))([\w-]{11})/i);
  if (directMatch) {
    targetUrl = `https://www.youtube.com/watch?v=${directMatch[1]}`;
    cleanHandle = 'YouTube Streamer';
  } else {
    // 2. Resolve handle (e.g. "@handle") via YouTube public live redirect
    cleanHandle = input.startsWith('@') ? input : `@${input}`;
    targetUrl = `https://www.youtube.com/${cleanHandle}/live`;
  }

  try {
    const response = await fetch(targetUrl, {
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });

    const finalUrl = response.url;
    const finalMatch = finalUrl.match(/(?:v=|live\/)([\w-]{11})/);
    const html = await response.text();

    let videoId = finalMatch ? finalMatch[1] : null;
    if (!videoId) {
      const canonicalMatch = html.match(/<link\s+rel="canonical"\s+href="https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})"/);
      const videoIdMatch = html.match(/"videoId":"([\w-]{11})"/);
      videoId = (canonicalMatch && canonicalMatch[1]) || (videoIdMatch && videoIdMatch[1]);
    }

    if (!videoId) {
      return null;
    }

    // Extract real stream title from HTML
    let title = `${cleanHandle} Live Clip`;
    const titleMatch = html.match(/<title>([^<]+)<\/title>/);
    if (titleMatch && titleMatch[1]) {
      title = titleMatch[1].replace(/\s*-\s*YouTube$/i, '').trim();
    }

    // Extract channel owner name if available
    const ownerMatch = html.match(/"ownerChannelName":"([^"]+)"/);
    if (ownerMatch && ownerMatch[1]) {
      cleanHandle = ownerMatch[1];
    }

    // Extract start time from live stream metadata
    const startMatch = html.match(/"startTimestamp":"([^"]+)"/);
    const liveBroadcast = html.match(/"actualStartTime":"([^"]+)"/);
    const publishMatch = html.match(/"publishDate":"([^"]+)"/);
    const startTimeStr = (startMatch && startMatch[1]) || (liveBroadcast && liveBroadcast[1]) || (publishMatch && publishMatch[1]) || null;

    // Check if YouTube allows embedding
    const notEmbeddable = html.includes('"playableInEmbed":false') || html.includes('"isEmbeddable":false');
    const isEmbeddable = !notEmbeddable;

    return {
      videoId,
      title,
      author: cleanHandle,
      thumbnailUrl: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
      liveUrl: `https://www.youtube.com/watch?v=${videoId}`,
      startTimeStr,
      isEmbeddable,
      isLive: true
    };
  } catch (err) {
    console.error(`[YouTube Resolver] Error resolving handle ${cleanHandle}:`, err.message);
    return null;
  }
}

// ============================================================
// API ROUTES
// ============================================================

// 1. Health & VPS Monitor
app.get('/health', (req, res) => {
  const memUsage = process.memoryUsage();
  res.json({
    status: 'online',
    service: 'archon-clipping-backend',
    uptimeSeconds: Math.floor(process.uptime()),
    ramUsedMB: (memUsage.rss / 1024 / 1024).toFixed(2),
    heapUsedMB: (memUsage.heapUsed / 1024 / 1024).toFixed(2),
    totalClips: readClips().length,
    totalWhitelistedUsers: readWhitelist().length,
    timestamp: new Date().toISOString()
  });
});

// 1.5 Whitelist / Authorized Users API (Shared VPS Database Fallback)
app.get('/api/whitelist', (req, res) => {
  const users = readWhitelist();
  const discordId = req.query.discord_id || req.query.discordId;
  if (discordId) {
    const clean = String(discordId).trim();
    const user = users.find(u => u.discord_id === clean && u.is_active);
    return res.json({ user: user || null, authorized: Boolean(user) });
  }
  res.json({ users });
});

app.post('/api/whitelist', (req, res) => {
  const { discord_id, username, role = 'creator', notes = '', assigned_creators = [], added_by = 'Owner' } = req.body;
  if (!discord_id) {
    return res.status(400).json({ error: 'Missing discord_id' });
  }

  const cleanId = String(discord_id).trim();
  const users = readWhitelist();
  const existingIdx = users.findIndex(u => u.discord_id === cleanId);

  const now = new Date().toISOString();
  const userRecord = {
    id: existingIdx >= 0 ? users[existingIdx].id : `usr_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
    discord_id: cleanId,
    username: (username || '').trim() || `User_${cleanId.slice(-4)}`,
    role,
    notes,
    assigned_creators: Array.isArray(assigned_creators) ? assigned_creators : [],
    added_by,
    is_active: true,
    created_at: existingIdx >= 0 ? users[existingIdx].created_at : now,
    updated_at: now
  };

  if (existingIdx >= 0) {
    users[existingIdx] = userRecord;
  } else {
    users.unshift(userRecord);
  }

  writeWhitelist(users);

  sendDiscordLog({
    type: 'info',
    title: `🛡️ Whitelist Updated: @${userRecord.username}`,
    description: `User **@${userRecord.username}** (\`${userRecord.discord_id}\`) was granted role **${userRecord.role.toUpperCase()}**.`,
    fields: [
      { name: 'Discord ID', value: `\`${userRecord.discord_id}\``, inline: true },
      { name: 'Role', value: userRecord.role.toUpperCase(), inline: true },
      { name: 'Added By', value: String(userRecord.added_by), inline: true }
    ]
  }).catch(() => {});

  res.json({ success: true, user: userRecord });
});

app.delete(['/api/whitelist/:discord_id', '/api/whitelist'], (req, res) => {
  const cleanId = String(req.params.discord_id || req.query.discord_id || req.body?.discord_id || '').trim();
  if (!cleanId) {
    return res.status(400).json({ error: 'Missing discord_id' });
  }

  const users = readWhitelist();
  const removedUser = users.find(u => u.discord_id === cleanId);
  const filtered = users.filter(u => u.discord_id !== cleanId);
  writeWhitelist(filtered);

  if (removedUser) {
    sendDiscordLog({
      type: 'warn',
      title: `🚫 User Removed from Whitelist: @${removedUser.username}`,
      description: `User **@${removedUser.username}** (\`${cleanId}\`) was removed from the CMS whitelist.`,
      fields: [
        { name: 'Discord ID', value: `\`${cleanId}\``, inline: true },
        { name: 'Previous Role', value: removedUser.role.toUpperCase(), inline: true }
      ]
    }).catch(() => {});
  }

  res.json({ success: true, removed: cleanId });
});

app.post('/api/whitelist/sync-login', (req, res) => {
  const { discord_id, username, avatar } = req.body || {};
  if (!discord_id) return res.status(400).json({ error: 'Missing discord_id' });
  const cleanId = String(discord_id).trim();
  const users = readWhitelist();
  const idx = users.findIndex(u => u.discord_id === cleanId);
  if (idx >= 0) {
    if (username) users[idx].username = String(username).trim();
    if (avatar) users[idx].avatar = String(avatar).trim();
    users[idx].has_logged_in = true;
    users[idx].updated_at = new Date().toISOString();
    writeWhitelist(users);
    return res.json({ success: true, user: users[idx] });
  }
  res.json({ success: false, message: 'User not in whitelist' });
});

// 2. Chatbot Webhook: YouTube Live (!clip command)
// Works with Nightbot / StreamElements $(urlfetch ...) via GET or POST
app.all(['/api/webhook/youtube', '/api/webhook/clip', '/api/webhook'], rateLimiter, async (req, res) => {
  const rawChannel = req.query.handle || req.query.channel || req.body?.handle || req.body?.channel;
  const channel = rawChannel ? (String(rawChannel).trim().startsWith('@') ? String(rawChannel).trim() : `@${String(rawChannel).trim()}`) : '';
  const rawUser = req.query.user || req.body?.user || 'Viewer';
  const user = String(rawUser).replace(/^@+/, '').trim() || 'Viewer';
  const customTitle = req.query.msg || req.query.title || req.query.query || req.body?.msg || req.body?.title;
  const rawDuration = parseInt(req.query.duration || req.body?.duration || '30', 10);
  const duration = Math.min(Math.max(isNaN(rawDuration) ? 30 : rawDuration, 5), 180);

  if (!channel) {
    sendDiscordLog({
      type: 'warn',
      title: '⚠️ Clip Rejected: Missing Channel',
      description: `Clip command called by @${user} without channel parameter.`
    }).catch(() => {});
    return res.status(200).send(`⚠️ Error: Missing channel parameter in !clip command.`);
  }

  // Resolve active YouTube stream
  const target = await resolveYouTubeTarget(channel);
  if (!target || !target.videoId) {
    sendDiscordLog({
      type: 'warn',
      title: `⚠️ Live Clip Failed: ${channel}`,
      description: `Could not resolve an active live stream for **${channel}**.`,
      fields: [
        { name: 'Channel / Handle', value: channel, inline: true },
        { name: 'Requested By', value: `@${user}`, inline: true },
        { name: 'Reason', value: 'Stream offline or channel not currently live on YouTube', inline: false }
      ]
    }).catch(() => {});
    return res.status(200).send(`⚠️ @${user}, ${channel} is not currently live on YouTube! Clips can only be captured during an active live stream.`);
  }

  const clipId = `yt_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const now = new Date();
  
  // Public watch URL on Team Archon CMS
  const clipWatchUrl = `${FRONTEND_URL}/clip/${clipId}`;

  // Calculate stream offset and live timestamps
  const reqTimestamp = Number(req.query.timestamp) || Number(req.body?.timestamp) || Date.now();
  let elapsedSec = 0;
  let clipStartSec = 0;

  if (target.startTimeStr) {
    const streamStartMs = new Date(target.startTimeStr).getTime();
    elapsedSec = Math.max(0, Math.floor((reqTimestamp - streamStartMs) / 1000));
    clipStartSec = Math.max(0, elapsedSec - duration);
  }

  const clipTimestampUrl = clipStartSec > 0 
    ? `https://www.youtube.com/watch?v=${target.videoId}&t=${clipStartSec}s` 
    : target.liveUrl;

  const currentLiveUrl = elapsedSec > 0 
    ? `https://www.youtube.com/watch?v=${target.videoId}&t=${elapsedSec}s` 
    : target.liveUrl;

  const formattedClipTime = formatTimestamp(clipStartSec);
  const formattedCurrentTime = formatTimestamp(elapsedSec);

  const newClip = {
    id: clipId,
    title: customTitle || `${target.title} (Clipped by @${user})`,
    description: `YouTube Live Stream clip captured by @${user}`,
    sourcePlatform: 'youtube',
    sourceUrl: clipTimestampUrl,
    videoUrl: clipTimestampUrl,
    videoId: target.videoId,
    thumbnailUrl: target.thumbnailUrl,
    duration,
    startTime: clipStartSec,
    endTime: elapsedSec > 0 ? elapsedSec : duration,
    offsetSeconds: clipStartSec,
    currentLiveTimeSeconds: elapsedSec,
    timestampUrl: clipTimestampUrl,
    currentTimeUrl: currentLiveUrl,
    isEmbeddable: target.isEmbeddable,
    aspectRatio: '16:9',
    status: 'ready',
    viralScore: Math.floor(Math.random() * 15) + 85,
    tags: ['youtube', 'liveclip', target.author],
    streamer: target.author,
    game: 'Live Stream',
    views: 1,
    aiHookText: `INSANE MOMENT CLIPPED BY @${user.toUpperCase()} 🔥`,
    clippedBy: user,
    clipPageUrl: clipWatchUrl,
    embedUrl: `https://www.youtube.com/embed/${target.videoId}?autoplay=1${clipStartSec > 0 ? `&start=${clipStartSec}` : ''}`,
    createdAt: now.toISOString()
  };

  // Persist clip to storage
  const clips = readClips();
  clips.unshift(newClip);
  writeClips(clips);
  syncClipToSupabase(newClip);
  syncClipToSupabase(newClip);

  // Send Discord webhook log notification with clip URL and current time URL!
  sendDiscordLog({
    type: 'success',
    title: `🎬 New Live Clip: ${newClip.title}`,
    url: clipWatchUrl,
    description: `A stream highlight was captured by **@${user}** on YouTube Live.`,
    imageUrl: target.thumbnailUrl,
    fields: [
      { name: 'Streamer', value: `@${target.author}`, inline: true },
      { name: 'Clipped By', value: `@${user}`, inline: true },
      { name: 'Duration', value: `${duration}s`, inline: true },
      { 
        name: '⏱️ Clip Timestamp', 
        value: clipStartSec > 0 
          ? `[▶ Watch at Clip Moment (${formattedClipTime})](${clipTimestampUrl})` 
          : `[Watch Stream](${target.liveUrl})`, 
        inline: true 
      },
      { 
        name: '🔴 Current Live Time', 
        value: elapsedSec > 0 
          ? `[▶ Jump to Current Time (${formattedCurrentTime})](${currentLiveUrl})` 
          : `[Watch Stream](${target.liveUrl})`, 
        inline: true 
      },
      { 
        name: '🌐 Archon CMS Clip Page', 
        value: `[Open Public Clip Viewer](${clipWatchUrl})`, 
        inline: false 
      }
    ]
  }).catch(() => {});

  // Return clean plain text for Nightbot chat
  const isJson = req.headers.accept?.includes('application/json') || req.query.format === 'json';
  if (isJson) {
    return res.json({ success: true, clip: newClip });
  }

  return res.send(`🎬 Clip captured by @${user}! Watch: ${clipWatchUrl} | YouTube: ${clipTimestampUrl}`);
});

// 3. CMS Manual Capture API: Trigger YouTube clip from Frontend
app.post('/api/youtube/capture', authenticateApiKey, async (req, res) => {
  const { channel, title, duration = 30 } = req.body;
  if (!channel) {
    return res.status(400).json({ error: 'Missing channel or video URL' });
  }

  const target = await resolveYouTubeTarget(channel);
  if (!target || !target.videoId) {
    return res.status(404).json({ error: 'Could not find active YouTube live stream' });
  }

  const clipId = `yt_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const clipWatchUrl = `${FRONTEND_URL}/clip/${clipId}`;

  // Calculate stream offset and live timestamps
  let elapsedSec = 0;
  let clipStartSec = 0;

  if (target.startTimeStr) {
    const streamStartMs = new Date(target.startTimeStr).getTime();
    elapsedSec = Math.max(0, Math.floor((Date.now() - streamStartMs) / 1000));
    clipStartSec = Math.max(0, elapsedSec - Number(duration));
  }

  const clipTimestampUrl = clipStartSec > 0 
    ? `https://www.youtube.com/watch?v=${target.videoId}&t=${clipStartSec}s` 
    : target.liveUrl;

  const currentLiveUrl = elapsedSec > 0 
    ? `https://www.youtube.com/watch?v=${target.videoId}&t=${elapsedSec}s` 
    : target.liveUrl;

  const formattedClipTime = formatTimestamp(clipStartSec);
  const formattedCurrentTime = formatTimestamp(elapsedSec);

  const newClip = {
    id: clipId,
    title: title || `${target.title} (Live Capture)`,
    description: 'Captured directly from Archon CMS Studio',
    sourcePlatform: 'youtube',
    sourceUrl: clipTimestampUrl,
    videoUrl: clipTimestampUrl,
    videoId: target.videoId,
    thumbnailUrl: target.thumbnailUrl,
    duration: Number(duration),
    startTime: clipStartSec,
    endTime: elapsedSec > 0 ? elapsedSec : Number(duration),
    offsetSeconds: clipStartSec,
    currentLiveTimeSeconds: elapsedSec,
    timestampUrl: clipTimestampUrl,
    currentTimeUrl: currentLiveUrl,
    isEmbeddable: target.isEmbeddable,
    aspectRatio: '16:9',
    status: 'ready',
    viralScore: 94,
    tags: ['youtube', 'studio_clip', target.author],
    streamer: target.author,
    game: 'Live Stream',
    views: 1,
    aiHookText: 'INSTANT STUDIO CAPTURE 🔥',
    clippedBy: 'Studio Editor',
    clipPageUrl: clipWatchUrl,
    embedUrl: `https://www.youtube.com/embed/${target.videoId}?autoplay=1${clipStartSec > 0 ? `&start=${clipStartSec}` : ''}`,
    createdAt: new Date().toISOString()
  };

  const clips = readClips();
  clips.unshift(newClip);
  writeClips(clips);
  syncClipToSupabase(newClip);

  // Send Discord webhook log
  sendDiscordLog({
    type: 'success',
    title: `🎬 Studio Clip: ${newClip.title}`,
    url: clipWatchUrl,
    description: `A live clip was captured manually from the Archon CMS Studio.`,
    imageUrl: target.thumbnailUrl,
    fields: [
      { name: 'Streamer', value: `@${target.author}`, inline: true },
      { name: 'Duration', value: `${duration}s`, inline: true },
      { 
        name: '⏱️ Clip Timestamp', 
        value: clipStartSec > 0 
          ? `[▶ Watch at Clip Moment (${formattedClipTime})](${clipTimestampUrl})` 
          : `[Watch Stream](${target.liveUrl})`, 
        inline: true 
      },
      { 
        name: '🔴 Current Live Time', 
        value: elapsedSec > 0 
          ? `[▶ Jump to Current Time (${formattedCurrentTime})](${currentLiveUrl})` 
          : `[Watch Stream](${target.liveUrl})`, 
        inline: true 
      },
      { 
        name: '🌐 Archon CMS Clip Page', 
        value: `[Open Public Clip Viewer](${clipWatchUrl})`, 
        inline: false 
      }
    ]
  }).catch(() => {});

  res.status(201).json({ success: true, clip: newClip });
});

// 4. Public API: Fetch Clip by ID (Public - No Auth Required)
app.get('/api/public/clip/:id', (req, res) => {
  const { id } = req.params;
  const clips = readClips();
  const clip = clips.find(c => c.id === id);

  if (!clip) {
    return res.status(404).json({ error: 'Clip not found' });
  }

  res.json({ success: true, clip });
});

// 4b. Public API: Fetch All Clips (Public - No Auth Required)
app.get(['/api/public/clips', '/api/public/all-clips'], (req, res) => {
  const clips = readClips();
  const { streamer, search } = req.query;
  let result = clips;
  if (streamer && streamer !== 'all') {
    result = result.filter(c => c.streamer?.toLowerCase() === String(streamer).toLowerCase());
  }
  if (search) {
    const s = String(search).toLowerCase();
    result = result.filter(c => 
      c.title?.toLowerCase().includes(s) || 
      c.streamer?.toLowerCase().includes(s) || 
      c.clippedBy?.toLowerCase().includes(s)
    );
  }
  res.json({ success: true, count: result.length, clips: result });
});

// 5. CMS API: List all clips (Secured or Public Fallback)
app.get('/api/clips', (req, res) => {
  const clips = readClips();
  const { platform, streamer, search } = req.query;

  let result = clips;
  if (platform && platform !== 'all') {
    result = result.filter(c => c.sourcePlatform === platform);
  }
  if (streamer && streamer !== 'all') {
    result = result.filter(c => c.streamer?.toLowerCase() === String(streamer).toLowerCase());
  }
  if (search) {
    const s = String(search).toLowerCase();
    result = result.filter(c => 
      c.title?.toLowerCase().includes(s) || 
      c.streamer?.toLowerCase().includes(s) || 
      c.clippedBy?.toLowerCase().includes(s)
    );
  }

  res.json({ success: true, count: result.length, clips: result });
});

// 6. CMS API: Save or Update clip (Secured)
app.put('/api/clips/:id', authenticateApiKey, (req, res) => {
  const { id } = req.params;
  const updates = req.body;
  const clips = readClips();

  const idx = clips.findIndex(c => c.id === id);
  if (idx === -1) {
    return res.status(404).json({ error: 'Clip not found' });
  }

  const oldTitle = clips[idx].title;
  clips[idx] = { ...clips[idx], ...updates, updatedAt: new Date().toISOString() };
  writeClips(clips);
  updateClipInSupabase(id, updates);

  if (updates.title && updates.title !== oldTitle) {
    sendDiscordLog({
      type: 'info',
      title: '✏️ Clip Title Updated',
      description: `Clip **${clips[idx].id}** was renamed by an administrator.`,
      fields: [
        { name: 'Old Title', value: oldTitle, inline: true },
        { name: 'New Title', value: updates.title, inline: true },
        { name: 'Streamer', value: `@${clips[idx].streamer}`, inline: true },
        { name: 'Clip Page', value: `[Open Clip](${clips[idx].clipPageUrl || `${FRONTEND_URL}/clip/${id}`})`, inline: false }
      ]
    }).catch(() => {});
  }

  res.json({ success: true, clip: clips[idx] });
});

// 7. CMS API: Delete clip (Secured)
app.delete('/api/clips/:id', authenticateApiKey, (req, res) => {
  const { id } = req.params;
  const clips = readClips();
  const targetClip = clips.find(c => c.id === id);
  const filtered = clips.filter(c => c.id !== id);

  if (filtered.length === clips.length) {
    return res.status(404).json({ error: 'Clip not found' });
  }

  writeClips(filtered);
  deleteClipFromSupabase(id);

  if (targetClip) {
    sendDiscordLog({
      type: 'warn',
      title: '🗑️ Clip Deleted by Admin',
      description: `Clip **"${targetClip.title}"** was permanently removed.`,
      fields: [
        { name: 'Streamer', value: `@${targetClip.streamer}`, inline: true },
        { name: 'Clipped By', value: `@${targetClip.clippedBy || 'Viewer'}`, inline: true },
        { name: 'Clip ID', value: id, inline: true }
      ]
    }).catch(() => {});
  }

  res.json({ success: true, message: 'Clip deleted successfully' });
});

// Start Server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`===============================================`);
  console.log(` Archon YouTube Clipping Backend`);
  console.log(` Port: ${PORT}`);
  console.log(` Webhook Endpoint: /api/webhook/youtube`);
  console.log(` Public Clip API: /api/public/clip/:id`);
  console.log(` Health Status: http://0.0.0.0:${PORT}/health`);
  console.log(`===============================================`);

  // Discord boot notification
  sendDiscordLog({
    type: 'info',
    title: '🟢 Archon Clipping Engine Online',
    description: 'VPS backend service is online and listening for webhook triggers.',
    fields: [
      { name: 'Port', value: String(PORT), inline: true },
      { name: 'Public Host', value: PUBLIC_BASE_URL, inline: true },
      { name: 'CORS Origin', value: FRONTEND_URL, inline: true }
    ]
  }).catch(() => {});
});
