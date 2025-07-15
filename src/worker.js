export default {
    async fetch(request) {
        try {
            return await handleRequest(request);
        } catch (err) {
            return new Response(JSON.stringify({ error: "Internal server error", details: err.message }), {
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
            badge: null
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
    constructor(collector) {
        this.collector = collector;
    }

    element(element) {
        if (!element.classList) return;

        // Check for direct status classes
        if (element.classList.contains("friend_status_offline")) {
            this.collector.data.status = 0;
        } else if (element.classList.contains("friend_status_online")) {
            this.collector.data.status = 1;
        } else if (element.classList.contains("game_state")) {
            this.collector.data.status = 2;
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
            if (srcset) {
                const sources = srcset.split(",").map(s => s.trim());
                const hdSource = sources.find(s => s.includes("2x"));
                if (hdSource) {
                    this.collector.data.avatarFull = hdSource.split(" ")[0];
                }
            }
            if (!this.collector.data.avatarFull) {
                this.collector.data.avatarFull = this.collector.data.avatar;
            }
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
            if (src) {
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
        this.isGameSection = false;
    }

    element(element) {
        if (!element.classList) return;

        // Check if we're in a game section
        if (element.classList.contains("miniprofile_gamesection")) {
            this.isGameSection = true;
            if (!this.collector.data.game) {
                this.collector.data.game = { name: "", logo: "" };
            }
        }

        if (this.isGameSection && element.classList.contains("miniprofile_game_name")) {
            const text = element.textContent;
            if (text && this.collector.data.game) {
                this.collector.data.game.name = text.trim();
            }
        }

        if (this.isGameSection && element.classList.contains("game_logo")) {
            const src = element.getAttribute("src");
            if (src && this.collector.data.game) {
                this.collector.data.game.logo = src;
            }
        }
    }
}

class BadgeHandler {
    constructor(collector) {
        this.collector = collector;
        this.currentBadge = null;
    }

    element(element) {
        if (!element.classList) return;

        // Initialize badge when we find a badge icon
        if (element.classList.contains("badge_icon")) {
            this.currentBadge = {
                icon: element.getAttribute("src") || "",
                name: "",
                xp: ""
            };
            this.collector.data.badge = this.currentBadge;
        }

        // Get badge name
        if (this.currentBadge && element.classList.contains("name")) {
            const name = element.textContent?.trim();
            if (name) {
                this.currentBadge.name = name;
            }
        }

        // Get badge XP
        if (this.currentBadge && element.classList.contains("xp")) {
            const xp = element.textContent?.trim();
            if (xp) {
                this.currentBadge.xp = xp;
            }
        }
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

    if (!steamid) {
        return new Response(JSON.stringify({ error: "Missing 'steamid' parameter" }), {
            status: 400,
            headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": getCorsOrigin(request)
            }
        });
    }

    let steamid64 = steamid;

    // Support profile URLs
    const match = steamid.match(/^https:\/\/steamcommunity\.com\/profiles\/(\d{17})$/);
    if (match) {
        steamid64 = match[1];
    }

    let accountId;
    try {
        const sid = new SteamID(steamid64);
        if (!sid.isValid()) {
            throw new Error("Invalid SteamID");
        }
        accountId = sid.accountid;
    } catch (err) {
        return new Response(JSON.stringify({ error: "Invalid SteamID format" }), {
            status: 400,
            headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": getCorsOrigin(request)
            }
        });
    }

    const miniProfileURL = `https://steamcommunity.com/miniprofile/${accountId}?l=${lang}`;

    try {
        const response = await fetch(miniProfileURL, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
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
            let msg = "Failed to fetch Steam profile";
            if (status === 404) msg = "Profile not found or private";
            if (status === 403) msg = "Access denied by Steam";

            return new Response(JSON.stringify({ error: msg, status }), {
                status: status > 500 ? 502 : status,
                headers: {
                    "Content-Type": "application/json",
                    "Access-Control-Allow-Origin": getCorsOrigin(request)
                }
            });
        }

        const collector = new ProfileDataCollector();
        const statusHandler = new StatusHandler(collector);
        const gameHandler = new GameInfoHandler(collector);
        const badgeHandler = new BadgeHandler(collector);

        const rewriter = new HTMLRewriter()
            .on(".persona", new TextContentHandler(collector, "name"))
            .on(".secondaryname", new TextContentHandler(collector, "secondaryName"))
            .on(".friend_status_offline", statusHandler)
            .on(".friend_status_online", statusHandler)
            .on(".game_state", statusHandler)
            .on(".playersection_avatar img", new AvatarHandler(collector))
            .on(".miniprofile_backgroundblur", new BackgroundHandler(collector))
            .on(".miniprofile_nameplate source[type='video/webm']", new BackgroundVideoHandler(collector))
            .on(".friendPlayerLevelNum", new LevelHandler(collector))
            .on(".miniprofile_gamesection", gameHandler)
            .on(".miniprofile_game_name", gameHandler)
            .on(".game_logo", gameHandler)
            .on(".miniprofile_featuredcontainer .badge_icon", badgeHandler)
            .on(".miniprofile_featuredcontainer .name", badgeHandler)
            .on(".miniprofile_featuredcontainer .xp", badgeHandler);

        await rewriter.transform(response).arrayBuffer();

        return new Response(JSON.stringify(collector.data), {
            headers: {
                "Content-Type": "application/json",
                "Cache-Control": "public, max-age=300",
                "Access-Control-Allow-Origin": getCorsOrigin(request),
                "X-Content-Type-Options": "nosniff",
                "X-Frame-Options": "DENY"
            }
        });
    } catch (err) {
        return new Response(JSON.stringify({ error: "Request failed", details: err.message }), {
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
    return allowedOrigins.includes(origin) ? origin : "*";
}

class SteamID {
    constructor(input) {
        this.input = input;
        this.accountid = null;
        this._isValid = false;
        this.parseInput();
    }

    parseInput() {
        // Handle SteamID64 format
        if (/^\d{17}$/.test(this.input)) {
            const steamID64 = BigInt(this.input);
            this.accountid = String(steamID64 & BigInt(0xFFFFFFFF));
            this._isValid = true;
            return;
        }

        // Handle profile URLs
        const profilePattern = /steamcommunity\.com\/profiles\/(\d{17})/;
        const match = this.input.match(profilePattern);

        if (match && match[1]) {
            const steamID64 = BigInt(match[1]);
            this.accountid = String(steamID64 & BigInt(0xFFFFFFFF));
            this._isValid = true;
            return;
        }

        this._isValid = false;
        throw new Error("Invalid SteamID format");
    }

    isValid() {
        return this._isValid;
    }
}