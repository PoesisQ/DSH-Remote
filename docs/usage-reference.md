# 日常使用参考

## 手机指令

| 指令 | 作用 |
| --- | --- |
| 直接发送文字 | 给当前会话发送 queue 消息 |
| `/steer <文字>` | 干预正在运行的回合 |
| `/status` | 主机、会话与模型状态 |
| `/sessions` | 查看会话列表 |
| `/use <ID 后缀>` | 切换当前会话 |
| `/new [目录]` | 新建并切换会话 |
| `/history [n]` | 最近 n 条对话摘要 |
| `/queue` / `/drop <ID>` | 查看或删除排队消息 |
| `/model` | 当前模型 |
| `/pending` | 未处理的审批与提问 |
| `/stop` | 中断当前回合 |
| `/mute` / `/unmute` | 静音普通推送；审批、提问和错误不静音 |
| `/verbose` / `/quiet` | 切换详细事件推送 |

审批或提问可能先在电脑处理，手机端应以最终确认结果为准。请勿反复提交敏感指令来测试连接，优先使用只读状态探测。

## 后台管理

统一后台：

```bash
node bin/dsh-suite.js status
node bin/dsh-suite.js usage
node bin/dsh-suite.js stop
```

使用自定义 profile 时，每条命令都带同一个 `--config /absolute/path/profile.json`。Windows 桌面已经启动 Suite 时，不要再手动 run 同一 profile。

独立桥接可使用 `scripts/start.sh` / `scripts/stop.sh`；旧 `start-all.sh` / `stop-all.sh` 适配旧式启动流程，不与 Suite 同时使用。

## 代理

需要让电脑桥接经过本机 HTTP 代理时，在私有 config.json 设置：

```json
{
  "network": {
    "httpsProxy": "http://127.0.0.1:YOUR_PORT"
  }
}
```

这是需要合并的配置片段，不是完整 config.json；将 YOUR_PORT 换成实际端口。独立桥接也支持 `DSH_REMOTE_HTTPS_PROXY`。本机 DSH 连接保持直连，代理地址不放进公共源码。

## 只读连接探测

```bash
node scripts/check-live.mjs config.json --probe
node scripts/check-live.mjs config.json --usage
```

探测通过自己的中继发送加密控制消息，但不发送新的 agent 任务。脚本只报告连接状态，以及余额/时段是否可用，不打印其具体值或密钥。

## 配对与升级

普通启动不打印配对码。需要时使用 `--show-pairing`；轮换使用 `--rotate-pairing`，会让旧配对失效，必须同时更新 Vercel 环境变量与手机配置。不要把轮换当成普通升级步骤。

网页与 APK 各自保存配对。清理浏览器站点数据、卸载 App 或更换域名可能丢失原本的本地记录；升级前先备份，不要从删除数据开始排障。
