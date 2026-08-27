# DSH Suite 安装、迁移与恢复

## 范围

一个仓库、一套后台、多个平台入口。Windows 桌面显示本机 DSH，并提供余额/峰谷浮层、手机网页入口和主动查看 DR2 的菜单；PWA/Android 通过加密信箱遥控；NovaTab 可作为可选工作台入口。

DSH 的模型、会话、工具和审批仍由上游 DSH 执行。本仓库不复制上游运行时，不假定存在官方插件协议，不将不同平台强行包装成一个可执行文件。NovaTab 的书签/待办不会自动经过 Vercel 同步。

## 1. Linux / WSL

准备 Node.js 24.5+、已安装和完成登录的 DSH。用量组件另需 bash、Python 3 + PyYAML、curl、GCC 与 libzstd。安装这些依赖需按自己的系统处理；setup 不自动运行 apt 或修改全局设置。

在源码根目录：

```bash
node --version
command -v dsh
bash desktop/linux/setup.sh
node bin/dsh-suite.js init --workspace "$PWD"
node bin/dsh-suite.js doctor
node bin/dsh-suite.js run
```

默认配置位于 `$XDG_CONFIG_HOME/dsh-suite/config.json`，未设置 XDG 时是 `~/.config/dsh-suite/config.json`。可用 `--config /absolute/path/profile.json` 选择独立配置，也可设置 DSH_SUITE_CONFIG。init 不覆盖已有文件；使用其他工作目录时将 --workspace 换成实际目录。

独立终端运行 `node bin/dsh-suite.js status` / `stop` / `usage`。同一 profile 只允许一个管理进程；控制 socket 与 owner 文件位于私有临时目录，权限分别为 0600/0700。

配置字段：

| 字段 | 用途 |
| --- | --- |
| dsh.url | 本机 HTTP origin，默认 127.0.0.1:3080；不允许公网地址 |
| dsh.command / args | DSH 可执行文件及参数数组；不经过 shell 拼接 |
| dsh.cwd | DSH 工作目录，绝对 Linux 路径 |
| remoteConfig | 远程私有 config.json 的绝对路径；null 表示关闭互联 |
| usageScript | 白名单 JSON 用量脚本的绝对路径；null 表示关闭用量 |

用量适配器默认读取当前 Linux 用户的 .dsh。可在启动环境设置 DSH_DATA_DIR 或 DSH_ENV_FILE 指定数据目录/额外凭据文件；它们是本机私有配置，不写入公共脚本。费用沿用现有定价表，是估算，不替代实际账单；统计的是电脑最近活跃会话，不保证是手机所选会话。

## 2. 开启互联

先按 [Vercel 文档](deployment-vercel.md) 部署自己的 relay，生成远程 config.json。首次 init 可同时传入：

```bash
node bin/dsh-suite.js init --workspace "$PWD" --remote-config "$PWD/config.json"
```

已有 suite profile 则在私有 JSON 中填写 remoteConfig，不必重新生成 DR2。桌面和 bridge 在同一管理进程内共享 60 秒用量缓存，避免分别启动脚本和重复请求余额。

不要让独立 dsh-remote 和 suite 同时使用同一 config/state。suite 会检查同一用户的旧独立 bridge 并拒绝重复启动，而不是杀掉它。也不要用两个不同 suite profile 复用同一远程配置；每套 relay/信道应有唯一桥接进程。

## 3. Windows 桌面

开发构建需要 .NET Framework 4.x 编译器、WebView2 SDK 的 Core/WinForms/Loader 三个 DLL；SDK 目录用参数传入，不固定为作者机器路径。运行时需要 WebView2 Runtime。

```powershell
.\desktop\windows\Build.ps1 -SdkPath 'D:\sdk\webview2'
```

构建结果位于 dist/desktop。进入该目录运行安装脚本，BackendRoot 填写前面 Linux 源码目录的绝对路径：

```powershell
.\Install.ps1 -BackendRoot '/absolute/path/dsh-suite' -Distro 'Ubuntu' -CreateShortcut
```

默认安装到当前用户 LocalAppData/DSHSuite。已有同名 exe 时拒绝覆盖，可用 -TargetDirectory 指向一个新的版本目录。-ProfilePath 指定 Linux 配置路径；-RelayUrl 指定自己的手机网页地址。不会从仓库默认值连接作者的网站。

安装旁边的 desktop.settings.json 是私有文件。DshUrl 要与 Linux profile 的 dsh.url 一致。首次启动前必须完成 Linux 初始化。关闭程序默认停止该 profile 的管理进程及它自己启动的 DSH；若 DSH 原本已由别的程序启动，只断开套件，不终止外部 DSH。

旧/新桌面暂共享单实例标识，避免同时控制同一 DSH。请先正常退出旧桌面再打开新桌面。StopOnClose=false 是高级保留后台选项，恢复连接/关闭日志管道场景仍需人工验收，首次迁移建议保持 true。

## 4. NovaTab 可选浏览器模块

```bash
cd modules/novatab
npm ci
npm exec wxt prepare
npm run compile
npm run build
```

在 Edge/Chrome 扩展管理页使用开发者模式载入 .output/chrome-mv3。已有 NovaTab 用户先用旧版的导出功能备份设置；不要卸载旧扩展来试新版本，开发者载入路径/扩展 ID 改变可能对应新的本地存储区。

右下角 DSH / ··· 设置自己的网页或本机 DSH 地址。不填写 DR2。原有壁纸、搜索、书签、快捷链接、待办、历史/下载入口保留；DSH 入口只打开页面，没有增加向 relay 上传浏览器数据的代码。

## 5. 从旧版迁移

1. 备份私有 config.json、state.json、桌面设置和 DSH 自己的数据；备份不要放进公开仓库。
2. 保留原安装。正常停止独立 bridge（原仓库的 scripts/stop.sh），然后正常退出旧桌面。
3. 新 suite profile 指向原远程 config.json。不要 rotate-pairing，保留原信道、密钥和 state。
4. 启动 suite，确认 status，再打开新桌面/手机。不要同时手动 run 和让桌面 run 同一个 profile。
5. 验收配对、消息、审批、退出、VPN 断开重连。失败时停止新 suite，再启动原桌面和原 bridge；不删除旧状态。

从源码复制到新路径后，要更新私有 BackendRoot、usageScript 和其他绝对配置路径。公共代码可以移动；本机配置不会猜测旧位置。

## 故障恢复

- STATE_UNREADABLE：保留损坏 state 文件，检查备份。不要自动清空后重放历史命令。
- profile already running：使用相同 --config 查询 status。不要按端口或进程名批量杀进程。
- incomplete/unknown lock：先检查 owner 对应的 PID、启动时间和路径；程序不会擅自删除不明进程的记录。
- 用量不可用：运行 doctor，检查脚本依赖/凭据。不要把原始脚本输出、日志或密钥贴进公开 issue。
- 云端可达但电脑离线：这是不同状态，手机不会据此显示电脑在线。

## 尚未承诺

目前不是多人公共 SaaS、浏览器数据云同步服务或自动更新平台。Android 为 debug 签名候选版；桌面与扩展尚需人工验收。公开发布前需要确定 LICENSE、上游/依赖许可和正式签名策略。
