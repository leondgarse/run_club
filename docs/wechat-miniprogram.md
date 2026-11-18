# 部署为微信小程序

本文说明把 Run Club 做成微信小程序时，服务器（Cloudflare Pages + Functions + D1）需要做什么，以及微信后台要配置什么。

## 0. 先确认账号主体

在 小程序后台 → 设置 → 基本设置 查看主体类型，它决定走哪条路：

| 方案 | 做法 | 适用主体 | 工作量 |
|---|---|---|---|
| A. `<web-view>` 套壳 | 小程序只有一个页面，加载 `https://<域名>/` | 仅企业 / 个体工商户（**个人主体不能用 web-view**） | 小，现有网页几乎不改 |
| B. 原生小程序 | 新建 `miniprogram/` 目录，用 WXML/WXSS/JS 重写界面，用 `wx.request` 调现有 `/api/*` | 个人主体也可以 | 大：需移植 `public/app.js`、`index.html`；`plans.js`、`i18n.js`、`lib/` 可复用 |

个人主体请选 **方案 B**（已实现，见第 2 节）。

## 1. 域名（两种方案都需要）

- 不要用 `run-club.pages.dev`：它是共享域名，不适合填进微信的合法域名列表，在国内移动网络上也经常很慢或打不开。
- 在 Cloudflare Pages 项目里绑定自定义域名（Custom domains），HTTPS 由 Cloudflare 提供（TLS ≥ 1.2，符合要求）。
- **先用国内运营商的手机网络实测**能否稳定访问。如果 Cloudflare 在国内不稳定，根本解决办法是把 API 迁到国内云（如腾讯云 CloudBase / 云函数 + 数据库），那就是另一项较大的改动。
- 在 小程序后台 → 开发管理 → 开发设置 → 服务器域名 中填写该域名：
  - `request 合法域名`：所有 `/api/*` 调用和 `wgw.json`
  - `uploadFile 合法域名`：如用 `wx.uploadFile` 上传图片
  - `downloadFile 合法域名`：下载活动照片
- 方案 A 还要在 业务域名 中添加该域名：下载微信给的校验文件放到 `public/` 根目录后部署。业务域名实际上要求域名已做 ICP 备案。
- 服务器域名（request 等）是否要求 ICP 备案，以填写时后台的提示为准。

## 2. 已实现的内容（方案 B）

仓库里已经有原生小程序 `miniprogram/` 和对应的服务器改动：

| 位置 | 作用 |
|---|---|
| `functions/api/wxlogin.js` | 小程序 `wx.login()` 拿到 `code` → 服务器调用 `jscode2session` 换 `openid` → 返回 30 天有效的会话 token |
| `functions/api/_middleware.js` | `/api/*` 接受 `x-passcode`（网页）**或** `Authorization: Bearer <token>`（小程序） |
| `migrations/0009_wechat.sql` | `wx_users`（openid → TJH/WGW/SJH）、`wx_sessions`（只存 token 的 SHA-256） |
| `public/i18n-zh.js` | 中文文案单独成文件，网页和小程序共用 |
| `scripts/mp-sync.sh` | 把 `public/plans.js`、`public/i18n-zh.js` 复制到 `miniprogram/shared/`（该目录不进仓库） |
| `miniprogram/` | 首页（三人标签 + 📊 全部、周切换、计划勾选、今日建议、计划调整、我的记录、训练日历）、训练详情、添加/编辑活动（最多 3 张截图自动识别）、目标、首次登录 |

**登录流程**：某个微信号第一次打开时，选自己的名字并输入 Run Club 密码，服务器把这个 openid 绑定到该跑者；以后打开会自动登录，不再要密码。token 过期后会自动重新登录。

**照片**：上传用 `wx.request` 发送原始图片（服务器不变）；显示用 `wx.downloadFile` 带 token 下载后再展示，所以没有加签名 URL。

**主题**：跟随系统深色/浅色（`app.json` 的 `darkmode`）；语言在首页右上角切换 EN / 中文。

## 3. 上线步骤

1. **服务器**（在仓库根目录）：
   ```sh
   npx wrangler d1 execute run-club --remote --file=migrations/0009_wechat.sql   # 先跑迁移
   npx wrangler pages secret put WX_APPID      # 小程序后台 → 开发管理 → 开发设置
   npx wrangler pages secret put WX_SECRET     # AppSecret，只放 secret，绝不进仓库
   npx wrangler pages deploy --branch main --commit-dirty=true
   ```
2. **域名**：按第 1 节绑定自定义域名，填进 `miniprogram/config.js` 的 `API_BASE`，并在小程序后台登记为 request / uploadFile / downloadFile 合法域名。
3. **小程序代码**：
   ```sh
   ./scripts/mp-sync.sh        # 每次改了 public/plans.js 或 public/i18n-zh.js 都要重新运行
   ```
   用微信开发者工具「导入项目」选择 `miniprogram/` 目录，把 `project.config.json` 里的 `appid` 换成自己的
   （AppID 不是机密；开发者工具生成的 `project.private.config.json` 已被忽略）。
4. 开发者工具里预览、真机调试，然后「上传」→ 小程序后台把该版本设为 **体验版**，再把另外两人加为体验成员。
5. 解绑某个微信号（比如换手机号/认错人）：
   ```sh
   npx wrangler d1 execute run-club --remote --command "DELETE FROM wx_sessions WHERE openid IN (SELECT openid FROM wx_users WHERE person='SJH'); DELETE FROM wx_users WHERE person='SJH';"
   ```

## 4. 不需要改的

- CORS：`wx.request` 不是浏览器请求，不受 CORS 限制。
- D1 里的数据、`lib/` 里的教练计算、每日建议任务（`scripts/daily.sh`）、`wgw.json` 的生成方式都不变。
- 网页版照常使用，口令不变。
- 改训练计划（`public/plans.js`）后：网页 `deploy` 即可；小程序还要 `mp-sync.sh` + 重新上传，否则小程序显示旧计划。

## 5. 微信侧规则（比代码更关键）

- **只用体验版，不提交审核发布**：只有三个人用，把另外两位加为 成员管理 → 体验成员 即可。正式发布需要先完成 小程序备案（2023 年 9 月起强制）并通过内容审核；AI 生成的建议、用户上传的笔记和照片都可能触及生成式 AI 和 UGC 相关规定，个人主体在这两方面限制更多。
- **合法域名校验**：体验版同样校验合法域名，除非在手机上打开 开发调试。所以第 1 步的域名配置必须先完成。
- **隐私保护指引**：在 小程序后台 → 设置 → 服务内容声明 → 用户隐私保护指引 中声明使用相册 / 相机，否则 `wx.chooseMedia`（添加照片、截图）在体验版里也会被拦截。
- 开发时可在 微信开发者工具 → 详情 → 本地设置 中勾选「不校验合法域名」，仅限本地调试。
