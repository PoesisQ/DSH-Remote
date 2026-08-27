# 多网站 / 多应用

当前路线适合短 HTTP 加密信箱和离线补收。Vercel Functions 不作为常驻 WebSocket 服务器。[官方限制](https://vercel.com/docs/limits)

## 已支持的低风险方式

同一 Vercel 账号建立独立项目，分别部署相同中继代码；各应用必须有独立 URL、channel、Bearer、E2E key 和本地配置目录。可以复用 Redis，但新应用建议设置不同 `DSH_RELAY_NAMESPACE`。客户端不能自己选择服务器 namespace，授权依然固定绑定项目的 channel/token。

已有应用默认 namespace 留空以保留旧消息。共享 Redis 全库 Token 时，前缀隔离不是数据库权限隔离；需要更强边界就使用独立数据库/受限凭证。不要承诺每建一个项目都重新获得免费额度。

每个项目可使用自己的 `.vercel.app` 域名。拥有自定义域名后可以分成 `dsh.example.com` 和 `notes.example.com`；子域名只分入口，不自动分数据权限。[Vercel Domains](https://vercel.com/docs/domains/working-with-domains)

本轮已实现：部署 namespace、同源自动 CORS、无个人 URL 默认值、按 relay URL 隔离本地状态、SW 只清理自身缓存。仍建议独立 origin；当前 PWA 以 `/` 为根，**没有宣称支持直接放到 `/dsh` 等子路径**。

## 尚未提供的共享公共平台

一个部署供不同人自由注册使用，需要额外的用户/设备授权、独立 token 撤销、配额、速率限制、应用注册、AAD/协议升级方案与隔离测试。当前实例只有一个固定 channel，不提供这些能力。

同一 DR2 分享给别人等于分享远控/解密权限。也不要把同一 DR2 给多台执行 bridge 的电脑：它们可能重复执行同一条命令。

其他网站必须实现自己的发送、补拉、游标、加解密与数据冲突处理，不会仅因增加域名自动同步。可复用 `vercel/lib` 的信箱接口，DSH 命令适配层不应暴露给无关应用。

## 成本

按 30 天计算，一个电脑 15 秒空轮询约 172,800 次；三个这样的应用就约 518,400 次，未计手机/写入。Upstash Free 公布 500K commands/月、256 MB；应按数据库总量规划。[Upstash 定价](https://upstash.com/pricing/redis)

Hobby 适用于个人非商业用途；开放给他人前重新评估限制和滥用风险。[Vercel Hobby](https://vercel.com/docs/plans/hobby)
