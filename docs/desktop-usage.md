# 电脑端余额 / 峰谷用量接入

0.7 的手机网页与 Android App 顶部有紧凑用量入口，点击展开余额、峰谷时段、估算费用、Tokens、来源与采样时间。界面与聊天记录独立，不插入重复状态消息。

## 本地数据源

桥接调用已有电脑端脚本，不在 Vercel/手机查询服务商余额。通过私有 `config.json` 的 `usage.script` 指定**绝对路径**，或设置 `DSH_REMOTE_USAGE_SCRIPT`；默认关闭。不执行来自手机的脚本路径或命令，不使用 shell 字符串拼接。

```json
{ "usage": { "script": "/opt/dsh-desktop/dsh-status.sh" } }
```

脚本是独立桌面项目的组件，不随遥控端安装自动下载。自部署者可以接入自己的只读脚本，输出下面的 JSON 协议。不要把个人脚本路径、原始凭据、服务商密钥写进公开配置。

```json
{
  "sampledAt": 1787779200000,
  "model": "deepseek-v4-pro",
  "nowPeriod": "peak",
  "sessionId": "session-example",
  "scope": "latest-active-session",
  "balance": "53.35",
  "currency": "CNY",
  "costCurrency": "CNY",
  "totalCost": 1.2467,
  "totalTokens": 126000,
  "peak": { "hit": 10000, "miss": 20000, "out": 30000, "cost": 1.1 },
  "offpeak": { "hit": 20000, "miss": 20000, "out": 26000, "cost": 0.1467 },
  "pricingDate": "2026-08-17",
  "schedule": { "timezone": "Asia/Shanghai", "utcOffsetMinutes": 480, "offStartMinute": 30, "offEndMinute": 510 }
}
```

上例仅为协议演示，不是实时报价。原桌面脚本按最近修改的会话日志统计，**不是手机所选会话**；界面明确标注这个范围。费用沿用桌面脚本估算，混合模型会话等精确计费问题仍以桌面算法/服务商账单为准。本轮没有重新核定或更改价格。调价应修改电脑端的唯一数据源，而不是手机代码。

`balance: null` 表示查询失败/未配置，显示 `—`，不显示为 0。旧版脚本没有 `schedule` 时仍可显示余额与费用，但不凭空生成峰谷范围。新增时间/范围字段不影响原桌面组件。

## 同步与安全边界

- 手机仅在前台发送 `usage` 控制请求，常规间隔 120 秒；手动刷新至少间隔 15 秒。
- 桥接的脚本读取合并并发、缓存 60 秒（失败同样限频），18 秒超时，16 KiB 输出上限。异步读取不阻塞聊天/审批/在线心跳。
- 在 Linux 中超时终止该脚本进程组，包括 curl/python 子进程；每次查询使用独立、私有临时目录，退出后清理。
- 响应只序列化明确允许的数字/币种/模型/时段字段，原始错误、密钥、路径不发送。通过现有 DR2 加密中继传输。
- 查询与回复不进入持久业务 outbox、不触发快轮询。旧请求超过 60 秒丢弃，重开手机后发新请求。
- 手机只接受对应请求 ID 的回复；重新配对清空请求状态。快照按既有中继地址+信道隔离存储，超过 5 分钟标记历史，旧数据不能证明电脑在线。
- 原桌面数据脚本同样必须使用独立临时文件，避免桌面与遥控端并发互相覆盖。余额密钥只在本地使用。

## 排查

```bash
node scripts/check-live.mjs config.json --usage-local
node scripts/check-live.mjs config.json --usage
```

第一条检查本地脚本，第二条检查真实加密回环。只输出状态和“余额/时段是否可用”，不打印具体金额或密钥。`not-configured` 表示未指定脚本；`unavailable` 表示执行失败/超时/输出不符合协议；`ok` 但余额不可用时，请检查电脑端自己的凭据和网络。
