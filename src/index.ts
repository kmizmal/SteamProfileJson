import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import fetch from "node-fetch";
import * as cheerio from "cheerio";
import fs from "fs";
const allowedOrigins = JSON.parse(fs.readFileSync('./allowedOrigins.json', 'utf-8'));


const SteamID = require("steamid"); // Correctly import SteamID constructor

const app = express();

app.use(morgan("dev"));
app.use(helmet());
app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error("Not allowed by CORS"));
  }
}));
app.use(express.json());

app.get("/", async (req, res) => {
  const steamid = req.query.steamid as string;
  const lang = (req.query.lang as string) || "zh";

  if (!steamid) {
    res.status(400).json({ error: "Missing 'steamid' parameter" });
    return;
  }

  let sid: any;
  try {
    sid = new SteamID(steamid);
    if (!sid.isValid()) throw new Error("Invalid SteamID");
  } catch (e) {
    res.status(400).json({ error: "Invalid SteamID format" });
    return;
  }

  const accountId = sid.accountid;
  const miniProfileURL = `https://steamcommunity.com/miniprofile/${accountId}?l=${lang}`;
  console.log(miniProfileURL);

  try {
    const response = await fetch(miniProfileURL, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept-Language": lang
      }
    });

    const html = await response.text();
    const $ = cheerio.load(html);

    // 基础信息
    const name = $(".persona").first().text().trim();
    const secondaryName = $(".secondaryname").first().text().trim();
    // 状态优先级获取
    let status = "";
    if ($(".friend_status_offline").length) {
      //离线
      status = $(".friend_status_offline").first().text().trim();
    } else if ($(".friend_status_online").length) {
      // 在线
      status = $(".friend_status_online").first().text().trim();
    } else {
      // fallback到游戏状态
      status = $(".game_state").first().text().trim();
    }


    // 头像和高清头像
    const avatarEl = $(".playersection_avatar img");
    const avatar = avatarEl.attr("src") || "";
    const srcset = avatarEl.attr("srcset") || "";
    let avatarFull = "";

    if (srcset) {
      const sources = srcset.split(",").map(s => s.trim());
      const hdSource = sources.find(s => s.includes("2x"));
      if (hdSource) avatarFull = hdSource.split(" ")[0];
    }
    if (!avatarFull) avatarFull = avatar;

    // 背景图片或视频
    let background = "";
    let backgroundVideo = "";
    const backgroundImg = $(".miniprofile_backgroundblur").attr("src");
    if (backgroundImg) {
      background = backgroundImg;
    } else {
      const videoEl = $(".miniprofile_nameplate source[type='video/webm']");
      if (videoEl.length > 0) {
        backgroundVideo = videoEl.attr("src") || "";
      }
    }

    // Steam 等级
    const levelText = $(".friendPlayerLevelNum").first().text().trim();
    const level = parseInt(levelText) || 0;

    // 游戏信息
    const gameSection = $(".miniprofile_gamesection");
    const isPlaying = gameSection.length > 0;
    let gameName = "";
    let gameLogo = "";
    if (isPlaying) {
      gameName = gameSection.find(".miniprofile_game_name").text().trim();
      gameLogo = gameSection.find(".game_logo").attr("src") || "";
    }

    // 徽章信息（第一个 .miniprofile_featuredcontainer 中包含 badge_icon）
    let badge = null;
    const badgeContainer = $(".miniprofile_featuredcontainer").has(".badge_icon").first();
    if (badgeContainer.length > 0) {
      badge = {
        icon: badgeContainer.find(".badge_icon").attr("src") || "",
        name: badgeContainer.find(".description .name").text().trim(),
        xp: badgeContainer.find(".description .xp").text().trim()
      };
    }

    res.json({
      name,
      secondaryName,
      status,
      avatar,
      avatarFull,
      background,
      backgroundVideo,
      level,
      game: isPlaying ? { name: gameName, logo: gameLogo } : null,
      badge
    });

  } catch (err) {
    console.error("Fetch error", err);
    res.status(500).json({ error: "Failed to fetch Steam mini profile" });
  }
});


const port = 3000;
const server = app.listen(port, () => {
  console.log(`Listening: http://localhost:${port}`);
});

server.on("error", (err) => {
  if ("code" in err && err.code === "EADDRINUSE") {
    console.error(`Port ${port} is already in use. Please choose another port or stop the process using it.`);
  }
  else {
    console.error("Failed to start server:", err);
  }
  process.exit(1);
});
