# Vercel 自部署

每人使用自己的项目和配对。示例域名必须替换；不需要源码中写入作者或你的私人网址。

## 最小部署

1. 准备 Node 24，创建 Vercel 项目与 Upstash Redis。完整仓库的 Root Directory 是 `vercel`。
2. 在仓库根运行 `node bin/dsh-remote.js --config ./config.json --relay-url https://YOUR-PROJECT.vercel.app --init`。这会在本机输出敏感配对码；不要将输出粘贴到 issue/公共日志。
3. 将 Redis REST URL/Token、`DSH_RELAY_CHANNEL`、`DSH_RELAY_AUTH_SHA256`、`DSH_ALLOWED_ORIGINS` 配到项目环境变量。变量名见 `vercel/.env.example`；原始 Bearer 和 E2E key 不放 Vercel。
4. `npm test`、`node scripts/build-pwa.mjs`；保持 `vercel` 内生成物与 `phone` 一致。Git 部署直接使用这些生成物，不依赖 Vercel 能访问 Root Directory 以外源码。
5. 用已关联的项目部署。CLI 若在 `vercel` 目录运行，不再额外嵌套 `vercel`。环境变量更改需新部署生效。[Vercel 环境变量轮换](https://vercel.com/docs/environment-variables/rotating-secrets)
6. 打开自己的站点，用 DR2 配对；运行本机 DSH 和 bridge。health 仅测 Redis，需看到新探测确认的“电脑在线”才表明电脑与 DSH 都可用。

Preview 应使用独立测试凭证和 namespace，不能默认与生产隔离。不要给不可信 fork PR 生产环境变量。

## 配置与升级

- 初始化必须显式提供 URL；已有 config 优先，不会因环境变量或 `--relay-url` 意外改址。迁移服务应明确备份并更新配对，不当作普通升级。
- 同源 PWA 自动被 API 接受；其他可信前端需加入 `DSH_ALLOWED_ORIGINS`。Android 来源为 `https://appassets.androidplatform.net`，仍必须提供正确 Bearer。
- 默认 CSP 为 `connect-src 'self'`。若使用共享网页连接外部 relay，需单独审核并配置 CSP 与目标 CORS；默认产品是同源自部署，不允许任意站点。
- `DSH_RELAY_NAMESPACE` 可选，空值保持已有 `dr:v2:<channel>:<direction>`。新应用使用自己的 namespace。不要给已有实例随便改 namespace，否则旧消息不会自动迁移。
- 本地 `config.json`、`state.json`、`.runtime.env` 均不得提交；不同应用使用独立配置目录。电脑状态会绑定 relay URL，拒绝拿同一状态文件跨 relay 使用。
- 手机迁移旧本地记录时绑定首次升级的 relay；保留旧副本。切换域名不自动迁移浏览器存储。

## 在线检测与回滚

手机在前台大约每 30 秒发短时加密探测，45 秒内的匹配应答有效，在线租约 65 秒。正常离线最多在租约过期后反映；隐藏/重新配对会立即失效。DSH RPC 检查限时 4 秒。旧电脑 bridge 不认识探测时仍可收发，但新版页面不会谎报在线，需升级 bridge。

控制探测失败直接丢弃，下轮重试，不积压业务 outbox，也不触发 5 分钟 fast poll。网页状态不是毫秒级实时在线承诺。

发布前保留旧部署和 APK、私下备份 config/state。没有改 wire、密钥或默认 Redis key；0.6 允许恢复旧代码，但若手动改 namespace/凭证，代码回滚不会替你恢复数据。不要先清空手机存储来排除缓存问题。
