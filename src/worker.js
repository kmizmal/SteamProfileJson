export default {
    async fetch(request) {
        try {
            return await handleRequest(request);
        } catch (err) {
            return new Response(JSON.stringify({ error: "Internal server error" }), {
                status: 500,
                headers: {
                    "Content-Type": "application/json",
                    "Access-Control-Allow-Origin": getCorsOrigin(request)
                }
            });
        }
    }
};

class ProfileDataCollector {
    constructor() {
        this.data = {
            name: "",
            secondaryName: "",
            status: 0,
            avatar: "",
            avatarFull: "",
            background: "",
            backgroundVideo: "",
            level: 0,
            game: null,
            badge: []
        };
    }
}

class TextContentHandler {
    constructor(collector, key) {
        this.collector = collector;
        this.key = key;
    }

    element(element) {
        if (!this.collector.data[this.key]) {
            const text = element.textContent;
            if (text) {
                this.collector.data[this.key] = text.trim();
            }
        }
    }
}

class StatusHandler {
    static STATUS_MAP = {
        "offline": 0,
        "online": 1,
        "in-game": 2,
        "away": 3,
        "busy": 4
    };

    constructor(collector) {
        this.collector = collector;
    }

    element(element) {
        if (!element.classList) return;
        for (const cls of element.classList) {
            if (StatusHandler.STATUS_MAP[cls] !== undefined) {
                this.collector.data.status = StatusHandler.STATUS_MAP[cls];
                return;
            }
            if (cls.startsWith("border_color_")) {
                const key = cls.replace("border_color_", "");
                if (StatusHandler.STATUS_MAP[key] !== undefined) {
                    this.collector.data.status = StatusHandler.STATUS_MAP[key];
                    return;
                }
            }
        }
    }
}

class AvatarHandler {
    constructor(collector) {
        this.collector = collector;
    }

    element(element) {
        if (!this.collector.data.avatar) {
            this.collector.data.avatar = element.getAttribute("src") || "";
        }

        if (!this.collector.data.avatarFull) {
            const srcset = element.getAttribute("srcset") || "";
            const sources = srcset.split(",").map(s => s.trim().split(" ")).filter(pair => pair.length === 2);
            const hd = sources.find(pair => pair[1] === "2x");
            this.collector.data.avatarFull = hd ? hd[0] : this.collector.data.avatar;
        }
    }
}

class BackgroundHandler {
    constructor(collector) {
        this.collector = collector;
    }

    element(element) {
        if (!this.collector.data.background) {
            const src = element.getAttribute("src");
            if (src && !src.includes("shared_assets")) {
                this.collector.data.background = src;
            }
        }
    }
}

class BackgroundVideoHandler {
    constructor(collector) {
        this.collector = collector;
    }

    element(element) {
        if (!this.collector.data.backgroundVideo) {
            const src = element.getAttribute("src");
            if (src && src.endsWith(".webm")) {
                this.collector.data.backgroundVideo = src;
            }
        }
    }
}

class LevelHandler {
    constructor(collector) {
        this.collector = collector;
    }

    element(element) {
        if (this.collector.data.level === 0) {
            const text = element.textContent;
            const level = parseInt(text?.trim());
            if (!isNaN(level)) {
                this.collector.data.level = level;
            }
        }
    }
}

class GameInfoHandler {
    constructor(collector) {
        this.collector = collector;
        if (!collector.data.game) {
            collector.data.game = { name: "", logo: "", appid: "", storeUrl: "" };
        }
    }

    element(element) {
        if (!element.classList) return;

        if (element.classList.contains("miniprofile_game_name")) {
            const text = element.textContent;
            if (text) this.collector.data.game.name = text.trim();
        }

        if (element.classList.contains("game_logo")) {
            const src = element.getAttribute("src");
            if (src) {
                this.collector.data.game.logo = src;
                const match = src.match(/apps\/(\d+)\//);
                if (match) {
                    this.collector.data.game.appid = match[1];
                    this.collector.data.game.storeUrl = `https://store.steampowered.com/app/${match[1]}/`;
                }
            }
        }
    }
}

// 拆分的 Badge 处理器
class BadgeIconHandler {
    constructor(collector) {
        this.collector = collector;
        this.current = {};
        this.collector.data.badge.push(this.current);
    }

    element(element) {
        this.current.icon = element.getAttribute("src") || "";
    }
}

class BadgeNameHandler {
    constructor(collector) {
        this.collector = collector;
    }

    element(element) {
        const name = element.textContent?.trim();
        if (name) this.collector.data.badge.at(-1).name = name;
    }
}

class BadgeXPHandler {
    constructor(collector) {
        this.collector = collector;
    }

    element(element) {
        const xp = element.textContent?.trim();
        if (xp) this.collector.data.badge.at(-1).xp = xp;
    }
}

async function handleRequest(request) {
    if (request.method === "OPTIONS") return handleOptions(request);
    if (request.method !== "GET") {
        return new Response(null, {
            status: 405,
            headers: { "Access-Control-Allow-Origin": getCorsOrigin(request) }
        });
    }

    const url = new URL(request.url);
    const steamid = url.searchParams.get("steamid");
    const lang = url.searchParams.get("lang") || "zh";
    const userAgent = "SteamMiniProfileParser/1.0 (+https://github.com/your-repo)";

    if (!steamid || steamid.length < 3) {
        return new Response(JSON.stringify({ error: "Invalid 'steamid' parameter" }), {
            status: 400,
            headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": getCorsOrigin(request)
            }
        });
    }

    let accountId;
    try {
        const sid = new SteamID(steamid);
        if (!sid.isValid) throw new Error("Invalid SteamID format");
        accountId = sid.accountid;
    } catch (err) {
        return new Response(JSON.stringify({
            error: "SteamID解析失败",
            details: err.message,
            supported_formats: ["SteamID64", "Profiles URL"]
        }), {
            status: 400,
            headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": getCorsOrigin(request)
            }
        });
    }

    const miniProfileURL = `https://steamcommunity.com/miniprofile/${accountId}/?l=${lang}`;

    try {
        const response = await fetch(miniProfileURL, {
            headers: {
                "User-Agent": userAgent,
                "Accept-Language": lang,
                "Referer": "https://steamcommunity.com/"
            },
            cf: {
                cacheTtl: 300,
                cacheEverything: true
            }
        });

        if (!response.ok) {
            const status = response.status;
            let msg = "Steam资料获取失败";
            if (status === 404) msg = "用户资料不存在或设置为私密";
            if (status === 403) msg = "访问被Steam拒绝";
            return new Response(JSON.stringify({ error: msg, status }), {
                status: status > 500 ? 502 : status,
                headers: {
                    "Content-Type": "application/json",
                    "Access-Control-Allow-Origin": getCorsOrigin(request)
                }
            });
        }

        const collector = new ProfileDataCollector();
        const rewriter = new HTMLRewriter()
            .on("span.persona", new TextContentHandler(collector, "name"))
            .on("span.persona", new StatusHandler(collector))
            .on(".secondaryname", new TextContentHandler(collector, "secondaryName"))
            .on(".playersection_avatar img", new AvatarHandler(collector))
            .on(".miniprofile_backgroundblur", new BackgroundHandler(collector))
            .on(".miniprofile_nameplate source[type='video/webm']", new BackgroundVideoHandler(collector))
            .on(".friendPlayerLevelNum", new LevelHandler(collector))
            .on(".miniprofile_game_name", new GameInfoHandler(collector))
            .on(".game_logo", new GameInfoHandler(collector))
            .on(".miniprofile_featuredcontainer .badge_icon", new BadgeIconHandler(collector))
            .on(".miniprofile_featuredcontainer .name", new BadgeNameHandler(collector))
            .on(".miniprofile_featuredcontainer .xp", new BadgeXPHandler(collector));

        await rewriter.transform(response).arrayBuffer();

        return new Response(JSON.stringify(collector.data), {
            headers: {
                "Content-Type": "application/json",
                "Cache-Control": "public, max-age=300",
                "Access-Control-Allow-Origin": getCorsOrigin(request),
                "X-Content-Type-Options": "nosniff",
                "X-Frame-Options": "DENY",
                "X-Source": "Steam MiniProfile Parser"
            }
        });
    } catch (err) {
        return new Response(JSON.stringify({ error: "请求处理失败", details: err.message }), {
            status: 500,
            headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": getCorsOrigin(request)
            }
        });
    }
}

function handleOptions(request) {
    return new Response(null, {
        headers: {
            "Access-Control-Allow-Origin": getCorsOrigin(request),
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
            "Access-Control-Max-Age": "86400",
            "Vary": "Origin"
        }
    });
}

function getCorsOrigin(request) {
    const allowedOrigins = [
        "https://yourdomain.com",
        "https://app.yourdomain.com",
        "http://localhost:3000",
        "http://127.0.0.1:5500",
        "https://sleepy.zmal.top",
    ];
    const origin = request.headers.get("Origin");
    return allowedOrigins.includes(origin) ? origin : "null";
}

class SteamID {
    constructor(input) {
        this.input = input;
        this.accountid = null;
        this.isValid = false;
        this.parseInput();
    }

    parseInput() {
        if (/^\d{17}$/.test(this.input)) {
            const steamID64 = BigInt(this.input);
            this.accountid = String(steamID64 & BigInt(0xFFFFFFFF));
            this.isValid = true;
            return;
        }

        const profilePattern = /steamcommunity\.com\/(?:profiles|id)\/([^\/?]+)/;
        const match = this.input.match(profilePattern);

        if (match && match[1]) {
            const idPart = match[1];
            if (/^\d+$/.test(idPart)) {
                this.accountid = String(BigInt(idPart) & BigInt(0xFFFFFFFF));
                this.isValid = true;
                return;
            }
            this.isValid = false;
            throw new Error("自定义URL需要额外解析，暂不支持");
        }

        this.isValid = false;
        throw new Error("无法识别的SteamID格式");
    }
}
