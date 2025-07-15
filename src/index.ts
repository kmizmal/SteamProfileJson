import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import fetch from "node-fetch";
import * as cheerio from "cheerio";
import fs from "fs";
import path from "path";
import SteamID from "steamid";
import NodeCache from "node-cache";
import { Request, Response, NextFunction } from "express";

// 1 分钟 TTL
const cache = new NodeCache({ stdTTL: 60, checkperiod: 60 });

// Load allowed origins
let allowedOrigins = [];
try {
  const originsPath = path.resolve('./allowedOrigins.json');
  allowedOrigins = JSON.parse(fs.readFileSync(originsPath, 'utf-8'));
} catch (err) {
  console.error('Warning: Could not load allowedOrigins.json, using default origins');
  allowedOrigins = ['http://localhost:3000', 'http://127.0.0.1:5500'];
}

const app = express();

// Middleware
app.use(morgan("combined"));
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    }
  }
}));

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    callback(new Error("Not allowed by CORS"));
  },
  credentials: true
}));

app.use(express.json({ limit: '1mb' }));

// Rate limiting
const rateLimitMap = new Map();
const RATE_LIMIT = 45;
const RATE_WINDOW = 60000;

function checkRateLimit(ip: string) {
  const now = Date.now();
  const userRequests = rateLimitMap.get(ip) || { count: 0, resetTime: now + RATE_WINDOW };

  if (now > userRequests.resetTime) {
    userRequests.count = 1;
    userRequests.resetTime = now + RATE_WINDOW;
  } else {
    userRequests.count++;
  }

  rateLimitMap.set(ip, userRequests);
  return userRequests.count <= RATE_LIMIT;
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, data] of rateLimitMap.entries()) {
    if (now > data.resetTime) {
      rateLimitMap.delete(ip);
    }
  }
}, 60000);

// Parse SteamID
function parseSteamID(steamid: string) {
  if (!steamid || typeof steamid !== 'string') {
    throw new Error("Invalid steamid parameter");
  }

  let steamid64 = steamid.trim();

  const profileMatch = steamid64.match(/^https:\/\/steamcommunity\.com\/profiles\/(\d{17})$/);
  if (profileMatch) {
    steamid64 = profileMatch[1];
  }

  const customMatch = steamid64.match(/^https:\/\/steamcommunity\.com\/id\/([^\/]+)$/);
  if (customMatch) {
    throw new Error("Custom URL resolution not supported, please use SteamID64 or profile URL");
  }

  let sid;
  try {
    sid = new SteamID(steamid64);
  } catch {
    throw new Error("Invalid SteamID format");
  }

  if (!sid.isValid()) {
    throw new Error("Invalid SteamID format");
  }

  return sid.accountid;
}

// Extract profile data
function extractProfileData(html: string) {
  const $ = cheerio.load(html);
  const $persona = $(".persona").first();
  const $secondaryName = $(".secondaryname").first();
  const $avatarImg = $(".playersection_avatar img");
  const $levelNum = $(".friendPlayerLevelNum").first();
  const $gameSection = $(".miniprofile_gamesection");
  const $badgeContainer = $(".miniprofile_featuredcontainer").has(".badge_icon").first();

  const name = $persona.text().trim();
  const secondaryName = $secondaryName.text().trim();

  let status = 0;
  if ($(".friend_status_online").length > 0) {
    status = 1;
  } else if ($(".game_state").length > 0) {
    status = 2;
  }

  const avatar = $avatarImg.attr("src") || "";
  let avatarFull = avatar;
  const srcset = $avatarImg.attr("srcset");
  if (srcset) {
    const hdMatch = srcset.match(/([^\s]+)\s+2x/);
    if (hdMatch) {
      avatarFull = hdMatch[1];
    }
  }

  let background = "";
  let backgroundVideo = "";
  const backgroundImg = $(".miniprofile_backgroundblur").attr("src");
  if (backgroundImg) {
    background = backgroundImg;
  } else {
    const videoSrc = $(".miniprofile_nameplate source[type='video/webm']").attr("src");
    if (videoSrc) {
      backgroundVideo = videoSrc;
    }
  }

  const levelText = $levelNum.text().trim();
  const level = parseInt(levelText) || 0;

  let game = null;
  if ($gameSection.length > 0) {
    const gameName = $gameSection.find(".miniprofile_game_name").text().trim();
    const gameLogo = $gameSection.find(".game_logo").attr("src") || "";
    if (gameName) {
      game = { name: gameName, logo: gameLogo };
    }
  }

  let badge = null;
  if ($badgeContainer.length > 0) {
    const badgeIcon = $badgeContainer.find(".badge_icon").attr("src") || "";
    const badgeName = $badgeContainer.find(".description .name").text().trim();
    const badgeXp = $badgeContainer.find(".description .xp").text().trim();
    if (badgeIcon || badgeName) {
      badge = { icon: badgeIcon, name: badgeName, xp: badgeXp };
    }
  }

  return {
    name,
    secondaryName,
    status,
    avatar,
    avatarFull,
    background,
    backgroundVideo,
    level,
    game,
    badge
  };
}

// Health check
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    cache: {
      keys: cache.keys().length,
      stats: cache.getStats()
    }
  });
});

// Main endpoint
app.get("/", async (req, res) => {
  const clientIp = req.ip || 'unknown';

  if (!checkRateLimit(clientIp)) {
    return res.status(429).json({
      error: "Rate limit exceeded",
      limit: RATE_LIMIT,
      window: "1 minute"
    });
  }

  try {
    const { steamid, lang = "en" } = req.query;

    const accountId = parseSteamID(typeof steamid === 'string' ? steamid : '');

    const validLangs = ["en", "zh", "de", "fr", "es", "ru", "ja", "ko"];
    const sanitizedLang = typeof lang === 'string' && validLangs.includes(lang.toLowerCase()) ? lang.toLowerCase() : "en";

    const cacheKey = `profile:${accountId}:${sanitizedLang}`;
    const cachedData = cache.get(cacheKey);
    if (cachedData) {
      return res.json({
        ...cachedData,
        cached: true,
        timestamp: new Date().toISOString()
      });
    }

    const miniProfileURL = `https://steamcommunity.com/miniprofile/${accountId}?l=${sanitizedLang}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(miniProfileURL, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": `${sanitizedLang},en;q=0.9`,
        "DNT": "1",
        "Connection": "keep-alive"
      },
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errorMsg = response.status === 404
        ? "Profile not found or is private"
        : response.status === 403
          ? "Access denied by Steam"
          : "Failed to fetch profile data";

      return res.status(response.status).json({
        error: errorMsg,
        status: response.status,
        steamid: accountId
      });
    }

    const html = await response.text();
    const profileData = extractProfileData(html);
    cache.set(cacheKey, profileData);

    res.json({
      ...profileData,
      cached: false,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    if (error instanceof Error) {
      console.error("Profile fetch error:", error.message);

      if (error.message.includes("Invalid SteamID")) {
        return res.status(400).json({
          error: "Invalid SteamID format",
          details: error.message,
          supportedFormats: [
            "SteamID64 (17 digits)",
            "Profile URL (https://steamcommunity.com/profiles/...)"
          ]
        });
      }

      if (error.name === "AbortError") {
        return res.status(504).json({ error: "Request timed out" });
      }

      return res.status(500).json({
        error: "Internal server error",
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    } else {
      console.error("Unknown error:", error);
      return res.status(500).json({ error: "Unknown error occurred" });
    }
  }

});

// CORS error handling
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({ error: 'CORS policy does not allow this origin.' });
  }
  next(err);
});

// Fallback error handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: "Internal server error",
    details: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: "Endpoint not found" });
});

// Start server
const port = process.env.PORT || 3000;
const server = app.listen(port, () => {
  console.log(`🚀 Server running on http://localhost:${port}`);
  console.log(`📊 Cache TTL: ${cache.options.stdTTL}s`);
  console.log(`⚡ Rate limit: ${RATE_LIMIT} requests/minute`);
});

// Graceful shutdown
function shutdown(signal: string) {
  console.log(`🛑 ${signal} received, shutting down gracefully`);
  server.close(() => {
    console.log('✅ Server closed');
    cache.close();
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

server.on("error", (err) => {
  if ((err as NodeJS.ErrnoException).code === "EADDRINUSE") {
    console.error(`❌ Port ${port} is already in use.`);
  } else {
    console.error("❌ Failed to start server:", err);
  }
  process.exit(1);
});
