# SteamProfileJson API

基于 Node.js 和 Express 的简易 API 服务，用于绕过`steamkey`抓取并解析 Steam 用户的 MiniProfile 信息，包括昵称、状态、头像、背景、Steam 等级、游戏状态和徽章等。

---

## 功能特点

- 支持通过 SteamID 查询用户 MiniProfile
- 自动解析用户昵称、状态（在线`1`/离线`0`/游戏中）、头像及高清头像
- 支持获取用户背景图片或视频
- 抓取用户 Steam 等级
- 获取当前游戏及游戏图标
- 获取用户徽章信息
- 支持跨域请求（CORS），并限制允许的来源
- 集成安全中间件 Helmet，记录访问日志（Morgan）

---

## 安装与运行

### 先决条件

- Node.js v16 及以上
- npm 或 pnpm/yarn 包管理工具
  
  > 推荐使用`pnpm`

### 安装依赖

```bash
pnpm i
````

### 配置允许的请求来源

项目根目录需要有一个 `allowedOrigins.json` 文件，格式示例：

```json
[
  "http://localhost:3000",
  "https://yourdomain.com"
]
```

该文件用于配置允许跨域请求的来源列表。

> 也可以填入`"*"`***不推荐***

### 启动服务

```bash
pnpm dev
```

默认启动一个开发环境服务器。

## 使用说明

### 查询 Steam MiniProfile

发送 GET 请求：

```
GET /?steamid=<steamid>&lang=<语言代码>
```

* `steamid`（必填）：目标 Steam 用户的 SteamID 字符串
* `lang`（可选）：语言代码，默认为 `zh`（简体中文）

### 示例请求

```bash
curl "http://localhost:3000/?steamid=76561198000000000&lang=en"
```

### 返回示例

```json
{
  "name": "用户名",
  "secondaryName": "次要昵称",
  "status": "在线",
  "avatar": "https://...",
  "avatarFull": "https://..._full.jpg",
  "background": "https://...jpg",
  "backgroundVideo": "",
  "level": 30,
  "game": {
    "name": "游戏名",
    "logo": "https://...png"
  },
  "badge": {
    "icon": "https://...png",
    "name": "徽章名",
    "xp": "1234 XP"
  }
}
```

---

## 说明

* 本项目通过抓取 Steam 社区 MiniProfile 页面实现数据获取，受限于 Steam 页面结构变化，解析规则可能需要维护更新。
* 请合理控制请求频率，避免被 Steam 服务器封禁。
* 本项目仅用于学习和研究目的，请勿用于商业用途。


如果你有任何问题或建议，欢迎提 Issue 或联系我！
