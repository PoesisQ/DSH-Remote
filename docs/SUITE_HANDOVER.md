# DSH Suite 0.8 技术交接

> 2026-08-28 桌面热修：已完成本机覆盖和启动/关窗/重开/加密用量探测。发行版标识的 WSL 参数不要无条件加引号，C# 重定向 Linux 输出必须指定 UTF-8。SplashTests 已加入 Build.ps1；分发桌面时同时包含 splash-logo.png。详见 RELEASE_0.8.md。Vercel 生产站点未切换。

## 当前实现

- 保留原 remote 的会话/审批/排队/steer/Markdown/真实在线状态/用量功能。
- bin/dsh-suite.js + src/suite-*.js：用户级配置、WSL supervisor、私有 Unix socket、只停止自身子进程；外部 DSH 可以复用。
- desktop/windows：可配置 WinForms + WebView2 壳、启动/重试/退出、用量浮层、原生配对查看和网页入口。原生消息验证 DSH origin，不向公网网页暴露本地桥。
- desktop/linux：由原桌面用量实现迁入，路径相对化、私有临时文件、凭据仅本机使用；src/usage.js 做输出白名单、超时/取消和合并缓存。
- modules/novatab：迁入原自研新标签页功能，新增本机保存的 DSH URL 入口。升级 WXT 后需独立 compile/build；不与 relay 共享书签/历史。
- phone 为唯一移动 UI 源码；build:pwa 同步到 vercel 与 Android assets。

## 重要边界

套件不是官方 DSH 插件。DSH 本体未纳入仓库，用户自行安装、登录并遵守上游许可。Android package ID 暂保留旧值以保持已有签名安装兼容，这不是连接作者服务器的地址。一个代码库仍需分别构建 Windows、Android、PWA 与扩展产物。

唯一性保护按 suite profile 生效，旧独立 bridge 有进程检查；不同 profile 不得指向同一 remoteConfig。下一步可实现跨安装路径的强租约，但不要在未经迁移验证时改写 state 协议。

NovaTab 浏览器权限来自已有功能，新增入口不增加远程上传。不得把“一体化”误解为自动上传用户所有项目/浏览器数据。

## 验证命令

```bash
npm run build:pwa
npm run check
bash desktop/linux/setup.sh
node scripts/audit-public.mjs
node scripts/export-public.mjs
cd modules/novatab
npm ci && npm exec wxt prepare && npm run compile && npm run build
npm audit
```

Windows：Build.ps1 同时编译并运行 SettingsTests（可信来源、参数转义、地址校验）。suite.test.js 使用隔离的 fake DSH 测试启停/复用/重复启动，不接触实际 DSH。

## 这轮风险修复

损坏 state 不再静默重置；相同 state 内容省略重复磁盘写入。手机 outbox 保存失败不继续上传。用量脚本支持取消，supervisor 关闭时回收。桌面必须收到 supervisor ready 才入主界面，日志轮换保留一份 previous。AEAD 测试翻转真实密文字节，双端拒绝非规范 Base64 编码。

NovaTab 同步 watcher 避免回写循环；待办同步防抖并检查单项配额；搜索引擎及数组越界增加防护；依赖升级只作用于本仓库副本，未修改旧扩展安装。

## Vercel 后续

继续使用现有加密信箱协议；环境变量/隔离说明以 deployment-vercel.md、multi-app.md、security.md 为准。默认各人自部署、每应用独立项目/命名空间/凭据；子域名只是入口，不替代数据库键、信道与鉴权隔离。不能直接宣布作者现有实例为多人公共服务。

本源码不携带真实项目 URL、Vercel/Redis token、DR2 或机器路径。运行环境的位置与部署关联属于私有配置，不应补回文档。未经用户指定不得重新登录、旋转配对、清空 Redis 或直接公开旧 Git 历史。

## 发布检查与未完成验收

使用无 .git 的 source.tar.gz 新建仓库，不直接推旧工作树历史。自动扫描不是完整 secret scanner；还需人工审阅 LICENSE、第三方 notice、截图、签名和 CI 日志。

需要在用户新安装上人工验收：高 DPI 桌面启动/关闭/重启/复制 DR2、WebView2 实际导航、VPN 切换、扩展数据导入和全部浏览器权限、APK 同签名覆盖与旧数据保留。通过编译/单元测试不代表这些已完成。新桌面候选包不自动替换旧安装。
