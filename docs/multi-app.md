# 同一 Vercel 地址接入多个私人应用

从 0.9.0 起，一个部署可以同时承载现有 DSH Remote 和多个由所有者预先登记的私人应用。它仍是短 HTTP 加密信箱，不是常驻 WebSocket 服务，也不是允许陌生人自行注册的公共平台。

## 路径与兼容性

现有 DSH Remote 继续使用以下路径，行为和 Redis key 均不改变：

```text
POST /api/push
GET  /api/pull
GET  /api/health
```

新应用使用独立路径：

```text
POST /api/apps/<app-id>/push
GET  /api/apps/<app-id>/pull
GET  /api/apps/<app-id>/health
```

`app-id` 只能包含小写字母、数字和连字符，最长 32 字符；`default`、`dsh`、`legacy`、`root` 保留。路径由 `vercel.json` rewrite 到内部网关，浏览器地址保持不变。

每个应用自动使用 Redis namespace `svc-<app-id>`。namespace 从服务器注册表派生，客户端不能通过请求选择或覆盖。即使两个应用误用了同一个 channel，Redis key 仍然隔离。

## 注册表

新应用只通过 Vercel 环境变量 `DSH_RELAY_APPS_JSON` 注册：

```json
{
  "notes": {
    "channel": "16_to_64_char_base64url_channel",
    "authSha256": "64_hex_sha256_of_the_raw_bearer",
    "allowedOrigins": [
      "https://notes.example.com"
    ]
  },
  "automation": {
    "channel": "another_16_to_64_char_channel",
    "authSha256": "another_64_hex_sha256",
    "allowedOrigins": [],
    "disabled": false
  }
}
```

规则：

- Vercel 只保存 `channel`、Bearer 的 SHA-256 和 CORS origin；不要放原始 Bearer、E2E key、聊天记录或客户端配置。
- `allowedOrigins: []` 表示仅允许同源网页和无 `Origin` 的原生/服务端请求。跨域网页必须逐个写入完整 origin，不能使用 `*`，也不能包含路径。
- Android `WebViewAssetLoader` 如需跨域请求，显式加入 `https://appassets.androidplatform.net`。这个 origin 不区分不同 APK，Bearer 仍是实际身份凭证。
- `disabled: true` 会让该 app-id 返回 404，可用于紧急停用；更换 Bearer 时更新哈希并重新部署。
- 注册表最多 32 个应用、48 KiB、每个应用最多 16 个 origin。Vercel Node.js 部署的全部环境变量仍受平台总计 64 KiB 限制。
- 注册表缺失、为空或没有对应 app-id 时，新路径保持关闭；不会回退到 DSH 的凭据。

不要修改现有的 `DSH_RELAY_CHANNEL`、`DSH_RELAY_AUTH_SHA256`、`DSH_ALLOWED_ORIGINS` 或空的 `DSH_RELAY_NAMESPACE` 来接入新应用。这些变量属于现有 DSH 路径。

## 本地生成一套应用凭据

在可信本机生成三份随机值，不要在聊天、Issue、CI 日志或提交中生成：

```js
import { createHash, randomBytes } from "node:crypto";

const channel = randomBytes(16).toString("base64url");
const authToken = randomBytes(32).toString("base64url");
const e2eKey = randomBytes(32).toString("base64url");
const authSha256 = createHash("sha256").update(authToken, "utf8").digest("hex");
```

拆分保存：

| 去向 | 内容 |
|---|---|
| Vercel `DSH_RELAY_APPS_JSON` | app-id、channel、`authSha256`、allowedOrigins |
| 该应用的两端私有配置 | base URL、app-id、channel、原始 `authToken`、`e2eKey` |
| GitHub / APK 静态资源 / 网页源码 | **以上私密值都不放** |

一个应用的参考私有配置如下；它不是可提交文件：

```json
{
  "relayUrl": "https://YOUR-PROJECT.vercel.app",
  "appId": "notes",
  "channel": "REPLACE_PRIVATE_CHANNEL",
  "authToken": "REPLACE_PRIVATE_BEARER",
  "e2eKey": "REPLACE_PRIVATE_32_BYTE_KEY"
}
```

## HTTP API

所有响应均为 JSON、`Cache-Control: no-store`。Bearer 放在请求头：

```http
Authorization: Bearer <raw-auth-token>
```

### 推送密文

```http
POST /api/apps/notes/push
Content-Type: application/json

{
  "channel": "...",
  "direction": "to-pc",
  "id": "base64url-message-id",
  "wire": "v2.<same-id>.<iv>.<ciphertext-and-tag>"
}
```

成功返回 `201`：

```json
{ "ok": true, "cursor": "1720000000000-0" }
```

### 增量拉取

```http
GET /api/apps/notes/pull?channel=...&direction=to-phone&after=0-0&limit=100
Authorization: Bearer <raw-auth-token>
```

成功返回：

```json
{
  "ok": true,
  "messages": [
    { "cursor": "1720000000000-0", "id": "...", "wire": "v2...." }
  ],
  "hasMore": false
}
```

`limit` 会限制在 1–100。客户端只在成功解密并处理后持久化最新 cursor；`hasMore` 为真时继续分页。发送语义是 at-least-once，断网重试可能产生重复，接收端必须按消息 ID 去重。

### 健康检查

```http
GET /api/apps/notes/health
```

它只表示注册表、路由和 Redis 是否可用，不代表另一台设备在线。应用在线状态应通过自己的短期加密 challenge/response 实现。

## 加密协议

服务端只验证 `wire` 外形并保存密文，不持有 `e2eKey`。为了直接复用本仓库实现，另一个应用应遵循 v2 信封：

1. 方向保留为 `to-pc` 与 `to-phone`。在非 DSH 应用中可分别理解为“客户端到常驻端”和“常驻端到客户端”。
2. 主密钥是 32 字节 `e2eKey`。
3. HKDF-SHA256：`salt = UTF8("dsh-remote:" + channel)`；`info = UTF8("dsh-remote/v2:" + direction)`；输出 32 字节。
4. 每条消息使用新的 12 字节随机 AES-GCM IV。
5. AAD 为 `UTF8("dsh-remote/v2|" + channel + "|" + direction + "|" + id)`。
6. 明文信封至少包含 `{ "v":2, "id":"...", "k":"kind", "ts":毫秒时间戳, "d":任意JSON数据 }`。
7. `wire = v2.<id>.<base64url(iv)>.<base64url(ciphertext+16-byte-tag)>`；Base64URL 必须采用无 padding 的规范编码。
8. 解密后再次验证版本、内外 ID、时间窗口和去重集合。不要把认证失败当成空消息静默写入状态。

Node 客户端可直接复用 `src/crypto.js` 的 `makeEnvelope`、`sealEnvelope`、`openEnvelope` 和 `SeenCache`。其他语言应以 `test/crypto.test.js` 为兼容性参考，并建立跨语言测试向量。

## 给接入 Agent 的实施顺序

1. 选择不含业务秘密的 app-id，例如 `notes`，不要使用随机 app-id 充当鉴权。
2. 在本机生成独立 channel、Bearer、E2E key；先备份到该应用的私有配置目录。
3. 仅把 server registry entry 合并到 `DSH_RELAY_APPS_JSON`，分别配置 Production/Preview；Preview 使用另一套凭据。
4. 重新部署后先请求 app health，再用错误 token、错误 origin、错误 channel 做负向测试。
5. 用测试密文完成 push → pull → decrypt；再测试断网重试、重复消息、游标持久化和两端重启。
6. 确认 `/api/health` 与 DSH Remote 仍工作，且现有 DR2 不需要重新配对。
7. 上线后按应用记录请求量；空轮询应使用退避和页面隐藏暂停，避免一个应用耗尽共享额度。

## 隔离边界与何时拆项目

当前隔离可以防止一个应用凭据直接读取另一个应用的流，但它们仍共享：

- 同一个 Vercel 项目、部署权限、Function 额度和日志面板；
- 同一个 Redis REST Token、数据库容量和命令额度；
- 同一份服务端代码及其供应链。

因此这是“一个所有者的多个私人应用”隔离，不是互不信任租户的安全边界。以下情况改用独立 Vercel 项目和独立 Redis：不同所有者、商业/公开注册、敏感数据等级差异明显、需要独立计费或撤销、某应用流量可能失控。

同一域名下的 `/api/apps/...` 是 API 子路径，不会自动托管另一个应用的 UI。另一个网页可以部署在自己的 origin 并加入 allowlist；若一定要使用同域 UI，应单独评审 `/apps/<app-id>/` 静态资源、CSP 和 Service Worker scope，不能让它接管根路径。

Vercel Functions 会按请求调用，不适合充当永久 WebSocket 进程；Hobby 与 Redis 免费额度按整个账号/数据库统计，而不是按 app-id 重置。参见 [Vercel Functions](https://vercel.com/docs/functions)、[Vercel rewrites](https://vercel.com/docs/routing/rewrites)、[Vercel limits](https://vercel.com/docs/limits)。
