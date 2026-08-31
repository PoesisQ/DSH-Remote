// DS Harness Desktop — Windows 宿主应用（WebView2，.NET Framework 4.8 / C# 5）
// 功能：单图标启动；启动时居中显示进度窗口（任务栏可见）；
//       就绪后内嵌显示 DSH Web GUI；关闭主窗口即停止 DS Harness；
//       服务意外停止时显示重试条；二次启动聚焦已有窗口。
using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Runtime.InteropServices;
using System.Net.Sockets;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace DshDesktop
{
    internal static class Program
    {
        internal const string MutexName = "DSHarness.SingleInstance";
        internal const string FocusEventName = "DSHarness.FocusEvent";

        private static Mutex singleInstanceMutex;

        [STAThread]
        private static void Main()
        {
            try { DesktopSettings.Load(); }
            catch (Exception ex) { MessageBox.Show(ex.Message, "DSH Suite setup", MessageBoxButtons.OK, MessageBoxIcon.Warning); return; }
            // Existing installations/backups are never removed by the new suite.

            bool createdNew;
            singleInstanceMutex = new Mutex(true, MutexName, out createdNew);
            if (!createdNew)
            {
                try
                {
                    EventWaitHandle ev = EventWaitHandle.OpenExisting(FocusEventName);
                    ev.Set();
                }
                catch { }
                return;
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new DshAppContext());
        }

    }

    internal sealed class DshAppContext : ApplicationContext
    {
        internal static int Port { get { return new Uri(Url).Port; } }
        internal static string Url { get { return DesktopSettings.Current.DshUrl; } }
        internal static string WslExe { get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "wsl.exe"); } }
        internal static string LogUncPath { get { return DesktopSettings.LogPath; } }

        private EventWaitHandle focusEvent;
        private MainForm mainForm;
        private bool restarting;

        internal DshAppContext()
        {
            focusEvent = new EventWaitHandle(false, EventResetMode.AutoReset, Program.FocusEventName);
            Thread t = new Thread(FocusLoop);
            t.IsBackground = true;
            t.Start();

            // 始终直接打开主窗口：热启动立即导航；冷启动在主窗口中央显示图标动画，
            // 同时拉起 supervisor/bridge（即使复用已有 DSH 也会启动套件）。
            ShowMain();
            if (!PortUp()) mainForm.StartColdBoot();
        }

        internal static bool PortUp()
        {
            try
            {
                using (TcpClient client = new TcpClient())
                {
                    IAsyncResult ar = client.BeginConnect(new Uri(Url).Host, Port, null, null);
                    using (WaitHandle wait = ar.AsyncWaitHandle) { if (!wait.WaitOne(500)) return false; client.EndConnect(ar); return client.Connected; }
                }
            }
            catch { return false; }
        }

        internal void ShowMain()
        {
            if (mainForm != null && !mainForm.IsDisposed)
            {
                mainForm.Show();
                mainForm.Activate();
                return;
            }
            mainForm = new MainForm(this);
            mainForm.FormClosed += OnMainFormClosed;
            mainForm.Show();
        }

        private void OnMainFormClosed(object sender, FormClosedEventArgs e)
        {
            if (restarting)
            {
                restarting = false;
                ShowMain();
                if (!PortUp()) mainForm.StartColdBoot();
                return;
            }
            ExitThread();
        }

        internal void Restart()
        {
            restarting = true;
            if (mainForm != null && !mainForm.IsDisposed)
            {
                mainForm.SkipStop = true;
                mainForm.Close();
            }
        }

        internal void ExitApp()
        {
            ExitThread();
        }

        private void FocusLoop()
        {
            while (true)
            {
                focusEvent.WaitOne();
                MainForm f = mainForm;
                if (f == null || f.IsDisposed) continue;
                try
                {
                    f.Invoke((MethodInvoker)delegate
                    {
                        if (f.WindowState == FormWindowState.Minimized) f.WindowState = FormWindowState.Normal;
                        f.Show();
                        f.Activate();
                    });
                }
                catch { }
            }
        }
    }

    internal sealed class MainForm : Form
    {
        private DshAppContext owner;
        private WebView2 webView;
        private Label statusStrip;
        private WaveBadge overlayBadge;
        private Label overlayStatus;
        private Button overlayRetry, overlayLog, overlayQuit;
        private System.Windows.Forms.Timer watchdog, startupTimer, transitionTimer;
        private Stopwatch startupClock = new Stopwatch();
        private MenuStrip appMenu;
        private bool pageLoaded, startupNavigated;
        private DateTime pageLoadedAt;
        private Process startProcess;
        private volatile bool backendReady;
        private bool startSucceeded;
        private bool closing;
        private bool skipStop;
        private bool statusBusy;
        private string widgetJs;
        private float dpiScale = 1f;
        internal static bool QuietErrors;   // 测试环境：出错时不弹模态框，避免无消息循环时挂死

        internal bool SkipStop { get { return skipStop; } set { skipStop = value; } }

        internal MainForm(DshAppContext owner)
        {
            this.owner = owner;
            EnableDarkControls();   // 进程级深色模式：滚动条等系统控件同步深色
            Text = "DS Harness";
            StartPosition = FormStartPosition.CenterScreen;
            float mscale;
            using (Graphics g = Graphics.FromHwnd(IntPtr.Zero)) { mscale = g.DpiX / 96f; dpiScale = mscale; }
            Func<int, int> MS = delegate(int v) { return (int)Math.Round(v * mscale); };
            Size = new Size(MS(1280), MS(840));
            MinimumSize = new Size(MS(960), MS(620));
            BackColor = Color.FromArgb(21, 21, 23);
            Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);

            webView = new WebView2();
            webView.Dock = DockStyle.Fill;
            webView.DefaultBackgroundColor = Color.FromArgb(21, 21, 23);
            Controls.Add(webView);

            statusStrip = new Label();
            statusStrip.Dock = DockStyle.Top;
            statusStrip.Height = 28;
            statusStrip.BackColor = Color.FromArgb(44, 44, 46);
            statusStrip.ForeColor = Color.FromArgb(232, 234, 237);
            statusStrip.TextAlign = ContentAlignment.MiddleCenter;
            statusStrip.Visible = false;
            Controls.Add(statusStrip);

            // 冷启动覆盖层：大窗口正中央的小图标动画（启动完成即消失、界面接管）
            overlayBadge = new WaveBadge();
            overlayBadge.Name = "startup-badge";
            overlayBadge.Visible = false;
            Controls.Add(overlayBadge);

            overlayStatus = new Label();
            overlayStatus.Name = "startup-status";
            overlayStatus.Text = "";
            overlayStatus.Font = new Font("Segoe UI Semilight", 10f);
            overlayStatus.ForeColor = Color.FromArgb(248, 113, 113);
            overlayStatus.BackColor = Color.FromArgb(21, 21, 23);
            overlayStatus.TextAlign = ContentAlignment.MiddleCenter;
            overlayStatus.Visible = false;
            Controls.Add(overlayStatus);

            overlayRetry = MakeOverlayButton("重新启动", "startup-retry", OnOverlayRetry);
            overlayLog = MakeOverlayButton("查看日志", "startup-log", OnOverlayLog);
            overlayQuit = MakeOverlayButton("退出", "startup-quit", OnOverlayQuit);
            Controls.Add(overlayRetry); Controls.Add(overlayLog); Controls.Add(overlayQuit);

            overlayBadge.BringToFront();
            overlayStatus.BringToFront();
            overlayRetry.BringToFront(); overlayLog.BringToFront(); overlayQuit.BringToFront();
            Resize += delegate { RecenterOverlay(); };

            startupTimer = new System.Windows.Forms.Timer();
            startupTimer.Interval = 200;
            startupTimer.Tick += OnStartupTick;

            Load += OnLoad;
            FormClosing += OnFormClosing;
            FormClosed += delegate { if (watchdog != null) { watchdog.Dispose(); watchdog = null; } if (startupTimer != null) { startupTimer.Dispose(); startupTimer = null; } if (transitionTimer != null) { transitionTimer.Dispose(); transitionTimer = null; } };
            appMenu = new MenuStrip();
            appMenu.BackColor = Color.FromArgb(28, 28, 30); appMenu.ForeColor = Color.Gainsboro;
            var remoteMenu = new ToolStripMenuItem("手机互联") { ForeColor = Color.Gainsboro };
            ToolStripMenuItem webItem = (ToolStripMenuItem)remoteMenu.DropDownItems.Add("打开手机网页", null, delegate { try { if (string.IsNullOrEmpty(DesktopSettings.Current.RelayUrl)) MessageBox.Show(this, "请在桌面设置文件中填写自己的 RelayUrl。", "互联设置"); else DesktopSettings.OpenExternal(DesktopSettings.Current.RelayUrl); } catch { } });
            webItem.ForeColor = Color.Gainsboro;
            ToolStripMenuItem pairItem = (ToolStripMenuItem)remoteMenu.DropDownItems.Add("查看 / 复制配对码", null, async delegate { await ShowPairing(); });
            pairItem.ForeColor = Color.Gainsboro;
            appMenu.Items.Add(remoteMenu);
            var settingsItem = new ToolStripMenuItem("设置文件") { ForeColor = Color.Gainsboro };
            settingsItem.Click += delegate { Process.Start("notepad.exe", DesktopSettings.Quote(DesktopSettings.SettingsPath)); };
            appMenu.Items.Add(settingsItem);
            var logItem = new ToolStripMenuItem("启动日志") { ForeColor = Color.Gainsboro };
            logItem.Click += delegate { Process.Start("notepad.exe", DesktopSettings.Quote(DesktopSettings.LogPath)); };
            appMenu.Items.Add(logItem);
            appMenu.Visible = false;   // 启动期间隐藏三个菜单，就绪过渡完成后才显示
            appMenu.Renderer = new ToolStripProfessionalRenderer(new DarkColorTable());   // 深色下拉菜单
            MainMenuStrip = appMenu; Controls.Add(appMenu);
        }

        private async void OnLoad(object sender, EventArgs e)
        {
            EnableDarkTitleBar(this);
            LogWidgetEvent("OnLoad:start");
            try
            {
                string userData = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "DSHarness", "WebView2");
                CoreWebView2Environment env = await CoreWebView2Environment.CreateAsync(null, userData);
                if (closing || IsDisposed) return;
                LogWidgetEvent("OnLoad:env-created");
                await webView.EnsureCoreWebView2Async(env);
                if (closing || IsDisposed) return;
                LogWidgetEvent("OnLoad:wv2-ready");
                webView.CoreWebView2.Settings.IsStatusBarEnabled = false;
                webView.CoreWebView2.NewWindowRequested += OnNewWindow;
                webView.CoreWebView2.NavigationStarting += delegate(object s, CoreWebView2NavigationStartingEventArgs nav) { if (!DesktopSettings.TrustedSource(nav.Uri)) { nav.Cancel = true; try { DesktopSettings.OpenExternal(nav.Uri); } catch { } } };
                webView.CoreWebView2.WebMessageReceived += OnWebMessageReceived;
                string widgetPath = Path.Combine(Path.GetDirectoryName(Application.ExecutablePath), "widget.js");
                widgetJs = File.Exists(widgetPath) ? File.ReadAllText(widgetPath) : null;
                LogWidgetEvent("OnLoad:widget " + (widgetJs == null ? "MISSING" : "len=" + widgetJs.Length.ToString()));
                if (widgetJs != null)
                {
                    string origin = new System.Web.Script.Serialization.JavaScriptSerializer().Serialize(new Uri(DshAppContext.Url).GetLeftPart(UriPartial.Authority));
                    await webView.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync("if(location.origin===" + origin + "){ " + widgetJs + " }");
                    LogWidgetEvent("OnLoad:script-injected");
                    webView.NavigationCompleted += delegate(object sender2, CoreWebView2NavigationCompletedEventArgs e2)
                    {
                        if (!e2.IsSuccess || !DesktopSettings.TrustedSource(webView.Source.AbsoluteUri)) return;
                        pageLoaded = true;
                        pageLoadedAt = DateTime.UtcNow;
                        try { webView.CoreWebView2.ExecuteScriptAsync(widgetJs); } catch { }
                    };
                }
                if (overlayBadge.Visible)
                {
                    // 冷启动：先显示覆盖层动画，等后端就绪后由 OnStartupTick 导航
                    LogWidgetEvent("OnLoad:cold-boot-overlay");
                }
                else
                {
                    startupNavigated = true;
                    webView.CoreWebView2.Navigate(DshAppContext.Url);
                    LogWidgetEvent("OnLoad:navigated");
                    StartWatchdog();
                    appMenu.Visible = true;
                }
            }
            catch (Exception ex)
            {
                LogWidgetEvent("OnLoad:ERROR " + ex.Message);
                if (!QuietErrors)
                    MessageBox.Show(this, "WebView2 初始化失败: " + ex.Message,
                        "DS Harness", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        [DllImport("dwmapi.dll")]
        private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);

        private static void EnableDarkTitleBar(Form form)
        {
            try
            {
                int value = 1;
                int hr = DwmSetWindowAttribute(form.Handle, 20, ref value, sizeof(int));
                if (hr != 0) hr = DwmSetWindowAttribute(form.Handle, 19, ref value, sizeof(int));
            }
            catch { }
        }

        // Win32 深色模式：让系统绘制的滚动条等非客户区控件跟随深色主题
        [DllImport("uxtheme.dll", EntryPoint = "#135")]
        private static extern int SetPreferredAppMode(int mode);   // 1 = AllowDark

        [DllImport("uxtheme.dll", EntryPoint = "#133")]
        private static extern bool AllowDarkModeForWindow(IntPtr hwnd, bool allow);

        [DllImport("uxtheme.dll", CharSet = CharSet.Unicode)]
        private static extern int SetWindowTheme(IntPtr hwnd, string subAppName, string subIdList);

        private static void EnableDarkControls()
        {
            try { SetPreferredAppMode(1); } catch { }
        }

        private static void DarkWindow(Control c)
        {
            try { AllowDarkModeForWindow(c.Handle, true); } catch { }
        }

        // 文本框滚动条只有套用 DarkMode_Explorer 主题才会变深
        private static void DarkEdit(TextBox box)
        {
            try
            {
                DarkWindow(box);
                SetWindowTheme(box.Handle, "DarkMode_Explorer", null);
                box.Invalidate();
            }
            catch { }
        }

        private void OnNewWindow(object sender, CoreWebView2NewWindowRequestedEventArgs e)
        {
            e.Handled = true;
            try { DesktopSettings.OpenExternal(e.Uri); } catch { }
        }

        private async void OnWebMessageReceived(object sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            if (!DesktopSettings.TrustedSource(e.Source) || closing || IsDisposed) return;
            string msg;
            try { msg = e.TryGetWebMessageAsString(); } catch { return; }
            if (msg == "widgetReady") { LogWidgetEvent("widgetReady"); return; }
            if (msg != "getStatus" || statusBusy) return;
            LogWidgetEvent("getStatus");
            statusBusy = true;
            try
            {
                string json = await FetchStatusJsonAsync();
                if (!string.IsNullOrEmpty(json) && !closing && !IsDisposed && DesktopSettings.TrustedSource(webView.Source.AbsoluteUri))
                    webView.CoreWebView2.PostWebMessageAsJson(json);
            }
            catch { }
            finally { statusBusy = false; }
        }

        private async Task<string> FetchStatusJsonAsync()
        {
            string value = await ReadBackend("usage");
            return value != null && value.StartsWith("{") ? value : null;
        }

        private async Task ShowPairing()
        {
            string value = await ReadBackend("pairing");
            if (closing || IsDisposed) return;
            if (value == null || !value.StartsWith("DR2.")) { MessageBox.Show(this, "尚未配置互联。请初始化中继并在套件配置中指定 remoteConfig。", "手机配对"); return; }
            using (var dialog = new Form())
            {
                dialog.Text = "私密配对码 · 不要公开分享";
                dialog.Size = new Size(600, 300);
                dialog.StartPosition = FormStartPosition.CenterParent;
                dialog.FormBorderStyle = FormBorderStyle.FixedDialog;
                dialog.MaximizeBox = false; dialog.MinimizeBox = false;
                dialog.BackColor = Color.FromArgb(21, 21, 23);
                dialog.ForeColor = Color.FromArgb(232, 234, 237);
                dialog.Font = new Font("Segoe UI Semilight", 10f);
                dialog.Padding = new Padding(16);

                var tip = new Label { Text = "该配对码包含远程控制权限，请仅在自己的设备上使用。", Dock = DockStyle.Top, Height = 36, ForeColor = Color.FromArgb(154, 160, 166), BackColor = Color.FromArgb(21, 21, 23) };
                var box = new TextBox { Multiline = true, ReadOnly = true, Dock = DockStyle.Fill, Text = value, ScrollBars = ScrollBars.Vertical, BackColor = Color.FromArgb(30, 30, 33), ForeColor = Color.FromArgb(232, 234, 237), BorderStyle = BorderStyle.FixedSingle, Font = new Font("Consolas", 10.5f) };
                var copy = new QuietButton { Text = "复制配对码", Dock = DockStyle.Fill, FlatStyle = FlatStyle.Flat, BackColor = Color.FromArgb(34, 34, 37), ForeColor = Color.FromArgb(216, 216, 221), Font = new Font("Segoe UI Semilight", 10f) };
                copy.FlatAppearance.BorderColor = Color.FromArgb(62, 62, 66);
                copy.FlatAppearance.MouseOverBackColor = Color.FromArgb(47, 47, 51);
                copy.FlatAppearance.MouseDownBackColor = Color.FromArgb(55, 55, 59);
                copy.Click += delegate { try { Clipboard.SetText(value); copy.Text = "已复制，请粘贴到自己的手机"; } catch { } };
                var copyBar = new Panel { Dock = DockStyle.Bottom, Height = 50, Padding = new Padding(0, 12, 0, 0), BackColor = Color.FromArgb(21, 21, 23) };
                copyBar.Controls.Add(copy);
                dialog.Controls.Add(box);
                dialog.Controls.Add(copyBar);
                dialog.Controls.Add(tip);
                dialog.Load += delegate { EnableDarkTitleBar(dialog); DarkWindow(dialog); DarkEdit(box); };   // 标题栏与滚动条同步深色
                dialog.ShowDialog(this);
            }
        }

        private async Task<string> ReadBackend(string action)
        {
            using (Process p = new Process())
            {
            p.StartInfo.FileName = DshAppContext.WslExe;
            p.StartInfo.Arguments = DesktopSettings.Current.WslArguments(action);
            p.StartInfo.UseShellExecute = false;
            p.StartInfo.CreateNoWindow = true;
            p.StartInfo.RedirectStandardOutput = true;
            p.StartInfo.StandardOutputEncoding = System.Text.Encoding.UTF8;
            try { if (!p.Start()) return null; }
            catch { return null; }
            Task<string> read = p.StandardOutput.ReadToEndAsync();
            if (await Task.WhenAny(read, Task.Delay(20000)) != read)
            {
                try { p.Kill(); } catch { }
                return null;
            }
            string s = read.Result == null ? "" : read.Result.Trim();
            return s.Length <= 20000 ? s : null;
            }
        }

        private void LogWidgetEvent(string ev)
        {
            try
            {
                string dir = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "DSHarness");
                Directory.CreateDirectory(dir);
                string path = Path.Combine(dir, "suite-widget.log");
                if (File.Exists(path) && new FileInfo(path).Length > 1000000) {
                    string previous = path + ".previous";
                    if (File.Exists(previous)) File.Delete(previous);
                    File.Move(path, previous);
                }
                File.AppendAllText(path,
                    DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + " " + ev + Environment.NewLine);
            }
            catch { }
        }

        private int Sc(int v) { return (int)Math.Round(v * dpiScale); }

        private Button MakeOverlayButton(string text, string name, EventHandler onClick)
        {
            Button b = new QuietButton();
            b.Text = text;
            b.Name = name;
            b.FlatStyle = FlatStyle.Flat;
            b.FlatAppearance.BorderColor = Color.FromArgb(62, 62, 66);
            b.FlatAppearance.MouseOverBackColor = Color.FromArgb(47, 47, 51);
            b.FlatAppearance.MouseDownBackColor = Color.FromArgb(55, 55, 59);
            b.BackColor = Color.FromArgb(34, 34, 37);
            b.ForeColor = Color.FromArgb(216, 216, 221);
            b.Font = new Font("Segoe UI Semilight", 9.5f);
            b.Visible = false;
            b.Click += onClick;
            return b;
        }

        private void RecenterOverlay()
        {
            int bw = Sc(96);
            overlayBadge.Bounds = new Rectangle((ClientSize.Width - bw) / 2, (ClientSize.Height - bw) / 2 - Sc(36), bw, bw);
            int sw = Sc(560), sh = Sc(44);
            overlayStatus.Bounds = new Rectangle((ClientSize.Width - sw) / 2, ClientSize.Height / 2 + Sc(28), sw, sh);
            int bw2 = Sc(112), bh2 = Sc(34), gap = Sc(12);
            int total = bw2 * 3 + gap * 2;
            int x0 = (ClientSize.Width - total) / 2, y = ClientSize.Height / 2 + Sc(84);
            overlayRetry.Bounds = new Rectangle(x0, y, bw2, bh2);
            overlayLog.Bounds = new Rectangle(x0 + bw2 + gap, y, bw2, bh2);
            overlayQuit.Bounds = new Rectangle(x0 + (bw2 + gap) * 2, y, bw2, bh2);
        }

        internal bool ProgressRunning { get { return overlayBadge.Running; } }

        internal void StartColdBoot(bool launchBackend = true)
        {
            if (startupTimer == null)
            {
                startupTimer = new System.Windows.Forms.Timer();
                startupTimer.Interval = 200;
                startupTimer.Tick += OnStartupTick;
            }
            // WebView2 是独立子窗口、永远盖在 WinForms 控件之上：
            // 冷启动期间隐藏它，让页面在后台加载、图标动画独占窗口；
            // 页面完全就绪且过渡结束后再一次性显示（不出现加载转圈）。
            webView.Visible = false;
            overlayBadge.Running = true;
            overlayBadge.Visible = true;
            overlayBadge.BringToFront();
            overlayStatus.Visible = false;
            overlayRetry.Visible = overlayLog.Visible = overlayQuit.Visible = false;
            RecenterOverlay();
            startupClock.Restart();
            startupTimer.Start();
            if (launchBackend) LaunchStartProcess();
        }

        private void LaunchStartProcess()
        {
            backendReady = false;
            startSucceeded = false;
            startProcess = new Process();
            startProcess.StartInfo.FileName = DshAppContext.WslExe;
            startProcess.StartInfo.Arguments = DesktopSettings.Current.WslArguments("run");
            startProcess.StartInfo.UseShellExecute = false;
            startProcess.StartInfo.CreateNoWindow = true;
            startProcess.StartInfo.WindowStyle = ProcessWindowStyle.Hidden;
            startProcess.StartInfo.RedirectStandardOutput = true;
            startProcess.StartInfo.RedirectStandardError = true;
            startProcess.StartInfo.StandardOutputEncoding = System.Text.Encoding.UTF8;
            startProcess.StartInfo.StandardErrorEncoding = System.Text.Encoding.UTF8;
            DataReceivedEventHandler log = delegate(object s, DataReceivedEventArgs e) {
                if (e.Data == null) return;
                if (Object.ReferenceEquals(s, startProcess) && e.Data == "DSH Suite ready (private local control socket)") backendReady = true;
                try { lock (typeof(MainForm)) {
                    Directory.CreateDirectory(Path.GetDirectoryName(DesktopSettings.LogPath));
                    if (File.Exists(DesktopSettings.LogPath) && new FileInfo(DesktopSettings.LogPath).Length > 2000000) {
                        string previous = DesktopSettings.LogPath + ".previous";
                        if (File.Exists(previous)) File.Delete(previous);
                        File.Move(DesktopSettings.LogPath, previous);
                    }
                    File.AppendAllText(DesktopSettings.LogPath, e.Data + Environment.NewLine);
                } } catch { }
            };
            startProcess.OutputDataReceived += log; startProcess.ErrorDataReceived += log;
            try { startProcess.Start(); startSucceeded = true; startProcess.BeginOutputReadLine(); startProcess.BeginErrorReadLine(); }
            catch (Exception ex) { ShowStartupError("无法启动 WSL: " + ex.Message); }
        }

        private void OnStartupTick(object sender, EventArgs e)
        {
            if (startSucceeded && startProcess.HasExited) { ShowStartupError("启动未完成\n请重试，或查看日志了解原因"); return; }
            if (backendReady && DshAppContext.PortUp())
            {
                startupTimer.Stop();
                if (webView.CoreWebView2 != null && !closing && !IsDisposed && !startupNavigated)
                {
                    startupNavigated = true;
                    try { webView.CoreWebView2.Navigate(DshAppContext.Url); } catch { }
                }
                LogWidgetEvent("cold-boot:ready");
                if (transitionTimer == null)
                {
                    transitionTimer = new System.Windows.Forms.Timer();
                    transitionTimer.Interval = 120;
                    transitionTimer.Tick += OnTransitionTick;
                }
                transitionTimer.Start();
                return;
            }
            if (startupClock.Elapsed.TotalSeconds >= 180)
            {
                startupTimer.Stop();
                ShowStartupError("启动超时（180 秒），请查看日志确认原因。");
            }
        }

        private void OnTransitionTick(object sender, EventArgs e)
        {
            // 页面在图标覆盖层下加载：等页面真正就绪后，再做收缩+淡出过渡，
            // 从而跳过中间的“DS Harness 转圈”画面。
            double waitMs = (DateTime.UtcNow - pageLoadedAt).TotalMilliseconds;
            if (pageLoaded && waitMs >= 700)
            {
                transitionTimer.Stop();
                FinishStartupTransition();
                return;
            }
            // 兜底：30 秒后无论页面是否就绪都过渡，避免永远卡在动画
            if (startupClock.Elapsed.TotalSeconds >= 30)
            {
                transitionTimer.Stop();
                FinishStartupTransition();
            }
        }

        private void FinishStartupTransition()
        {
            overlayBadge.Running = false;
            overlayBadge.Transition(delegate
            {
                if (IsDisposed) return;
                overlayBadge.Visible = false;
                webView.Visible = true;   // 此刻页面已完全就绪：直接露出成品界面，无转圈
                appMenu.Visible = true;
                if (watchdog == null) StartWatchdog();
                LogWidgetEvent("cold-boot:transition-done");
            });
        }

        internal void ShowStartupError(string message)
        {
            startupTimer.Stop();
            startupClock.Stop();
            overlayBadge.Running = false;
            overlayBadge.Visible = false;
            overlayStatus.Text = message;
            overlayStatus.Visible = true;
            overlayRetry.Visible = overlayLog.Visible = overlayQuit.Visible = true;
            overlayStatus.BringToFront();
            overlayRetry.BringToFront(); overlayLog.BringToFront(); overlayQuit.BringToFront();
            RecenterOverlay();
        }

        internal void ResetStartup()
        {
            overlayStatus.Text = "";
            overlayStatus.Visible = false;
            overlayRetry.Visible = overlayLog.Visible = overlayQuit.Visible = false;
            overlayBadge.Visible = true;
            overlayBadge.Running = true;
            RecenterOverlay();
            startupClock.Restart();
            startupTimer.Start();
        }

        private async void OnOverlayRetry(object sender, EventArgs e)
        {
            overlayRetry.Enabled = overlayLog.Enabled = overlayQuit.Enabled = false;
            if (startSucceeded && startProcess != null && !startProcess.HasExited)
                await Task.Run(new Action(RunStop));
            if (IsDisposed) return;
            overlayRetry.Enabled = overlayLog.Enabled = overlayQuit.Enabled = true;
            try { if (startProcess != null && startProcess.HasExited) startProcess.Dispose(); } catch { }
            ResetStartup();
            LaunchStartProcess();
        }

        private void OnOverlayLog(object sender, EventArgs e)
        {
            try { Process.Start("notepad.exe", DesktopSettings.Quote(DesktopSettings.LogPath)); } catch { }
        }

        private void OnOverlayQuit(object sender, EventArgs e)
        {
            if (startSucceeded && startProcess != null && !startProcess.HasExited) RunStop();
            if (owner != null) owner.ExitApp(); else Close();
        }

        private void StartWatchdog()
        {
            watchdog = new System.Windows.Forms.Timer();
            watchdog.Interval = 4000;
            watchdog.Tick += delegate
            {
                if (closing || skipStop) return;
                if (!DshAppContext.PortUp())
                {
                    watchdog.Stop();
                    statusStrip.Text = "DS Harness 服务已停止 —— 点击此处重新启动";
                    statusStrip.ForeColor = Color.FromArgb(252, 211, 77);
                    statusStrip.Visible = true;
                    statusStrip.Cursor = Cursors.Hand;
                    statusStrip.Click += OnRestartClick;
                }
            };
            watchdog.Start();
        }

        private void OnRestartClick(object sender, EventArgs e)
        {
            statusStrip.Click -= OnRestartClick;
            statusStrip.Cursor = Cursors.Default;
            statusStrip.ForeColor = Color.FromArgb(226, 232, 240);
            statusStrip.Visible = false;
            owner.Restart();
        }

        private async void OnFormClosing(object sender, FormClosingEventArgs e)
        {
            if (closing || skipStop || !DesktopSettings.Current.StopOnClose) return;
            e.Cancel = true;
            closing = true;
            Hide();   // 窗口立即消失，停止过程在后台安静完成
            try
            {
                webView.Enabled = false;
                await Task.Run(new Action(RunStop));
            }
            catch { }
            Close();
        }

        private void RunStop()
        {
            try
            {
                Process stop = new Process();
                stop.StartInfo.FileName = DshAppContext.WslExe;
                stop.StartInfo.Arguments = DesktopSettings.Current.WslArguments("stop");
                stop.StartInfo.UseShellExecute = false;
                stop.StartInfo.CreateNoWindow = true;
                stop.Start();
                if (!stop.WaitForExit(20000)) { try { stop.Kill(); } catch { } }
            }
            catch { }
        }

        // 启动动画本体：软件图标的活体版——黑底圆角卡 + 渐变波浪 + 光点沿波浪往返滑行。
        // 几何与配色与 make-icon.ps1 一致（底色为中性黑），仅光点由静态改为相位驱动。
        private sealed class WaveBadge : Control
        {
            private double phase;
            private double fade = 1;
            private System.Windows.Forms.Timer anim, trans;
            private Action transDone;
            private bool running = true;
            internal bool Running { get { return running; } set { running = value; if (value) anim.Start(); else anim.Stop(); Invalidate(); } }

            internal WaveBadge()
            {
                SetStyle(ControlStyles.OptimizedDoubleBuffer | ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint | ControlStyles.ResizeRedraw, true);
                BackColor = Color.FromArgb(21, 21, 23);   // 与启动窗口背景同色：图标无自身背景，融为一体
                anim = new System.Windows.Forms.Timer();
                anim.Interval = 33;              // 30fps
                anim.Tick += delegate { phase += 0.022; Invalidate(); }; // 往返约 3.0 秒
                anim.Start();
            }

            // 收缩 + 淡出过渡（完成后回调），用于启动完成时把界面交给 DSH 页面
            internal void Transition(Action done)
            {
                transDone = done;
                trans = new System.Windows.Forms.Timer();
                trans.Interval = 30;
                trans.Tick += delegate
                {
                    fade -= 0.1;
                    if (fade <= 0.02)
                    {
                        fade = 0; trans.Stop(); trans.Dispose(); trans = null;
                        if (transDone != null) { var d = transDone; transDone = null; d(); }
                    }
                    else Invalidate();
                };
                trans.Start();
            }

            protected override void Dispose(bool disposing)
            {
                if (disposing) { anim.Stop(); anim.Dispose(); if (trans != null) { trans.Stop(); trans.Dispose(); } }
                base.Dispose(disposing);
            }

            internal static GraphicsPath RoundedPath(Rectangle r, int radius)
            {
                GraphicsPath p = new GraphicsPath();
                int d = radius * 2;
                p.AddArc(r.X, r.Y, d, d, 180, 90);
                p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
                p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
                p.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
                p.CloseFigure();
                return p;
            }

            private static Color Alpha(Color c, double a)
            {
                return Color.FromArgb(Math.Max(0, Math.Min(255, (int)(c.A * a))), c.R, c.G, c.B);
            }

            protected override void OnPaint(PaintEventArgs e)
            {
                base.OnPaint(e);
                if (fade <= 0.02) return;
                Graphics g = e.Graphics;
                g.SmoothingMode = SmoothingMode.AntiAlias;
                int w = Math.Max(16, Width), h = Math.Max(16, Height);
                float s = (float)(0.55 + 0.45 * fade);
                RectangleF area = new RectangleF((w - w * s) / 2f, (h - h * s) / 2f, w * s, h * s);

                // 无底板、无描边：仅前景波浪与光点，直接融入启动窗口背景

                // 1) 柔和白色波浪 + 白光晕
                float x0 = area.Left + area.Width * 56f / 256f, x1 = area.Left + area.Width * 200f / 256f;
                float amp = area.Height * 42f / 256f, mid = area.Top + area.Height * 0.5f;
                int steps = Math.Max(24, (int)(area.Width / 2));
                PointF[] pts = new PointF[steps + 1];
                for (int i = 0; i <= steps; i++)
                {
                    float x = x0 + (x1 - x0) * i / steps;
                    pts[i] = new PointF(x, mid - amp * (float)Math.Sin(2 * Math.PI * (x - x0) / (x1 - x0)));
                }
                using (Pen glow = new Pen(Alpha(Color.FromArgb(46, 255, 255, 255), fade), Math.Max(2f, area.Width * 24f / 256f)))
                using (Pen wave = new Pen(Alpha(Color.FromArgb(255, 232, 236, 242), fade), Math.Max(2f, area.Width * 12f / 256f)))
                {
                    glow.LineJoin = LineJoin.Round; glow.StartCap = LineCap.Round; glow.EndCap = LineCap.Round;
                    wave.LineJoin = LineJoin.Round; wave.StartCap = LineCap.Round; wave.EndCap = LineCap.Round;
                    g.DrawLines(glow, pts);
                    g.DrawLines(wave, pts);
                }

                // 2) 琥珀光点沿波浪滑行：余弦缓动往返 + 呼吸光晕
                double d = 0.5 - 0.5 * Math.Cos(phase * Math.PI);
                float dx = x0 + (x1 - x0) * (float)d;
                float dy = mid - amp * (float)Math.Sin(2 * Math.PI * (dx - x0) / (x1 - x0));
                float breathe = (float)(0.92 + 0.08 * Math.Sin(phase * Math.PI * 2));
                float haloR = area.Width * 17f / 256f * breathe;
                float coreR = area.Width * 8f / 256f;
                float hiR = area.Width * 4f / 256f;
                using (SolidBrush halo = new SolidBrush(Alpha(Color.FromArgb(70, 251, 191, 36), fade)))
                    g.FillEllipse(halo, dx - haloR, dy - haloR, haloR * 2, haloR * 2);
                using (SolidBrush core = new SolidBrush(Alpha(Color.FromArgb(255, 251, 191, 36), fade)))
                    g.FillEllipse(core, dx - coreR, dy - coreR, coreR * 2, coreR * 2);
                using (SolidBrush hi = new SolidBrush(Alpha(Color.FromArgb(255, 255, 236, 179), fade)))
                    g.FillEllipse(hi, dx - hiR, dy - hiR, hiR * 2, hiR * 2);
            }
        }

        private sealed class QuietButton : Button
        {
            private bool hovered, pressed;
            internal QuietButton() { SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer, true); }
            protected override void OnMouseEnter(EventArgs e) { hovered = true; base.OnMouseEnter(e); Invalidate(); }
            protected override void OnMouseLeave(EventArgs e) { hovered = pressed = false; base.OnMouseLeave(e); Invalidate(); }
            protected override void OnMouseDown(MouseEventArgs e) { pressed = true; base.OnMouseDown(e); Invalidate(); }
            protected override void OnMouseUp(MouseEventArgs e) { pressed = false; base.OnMouseUp(e); Invalidate(); }
            protected override void OnPaint(PaintEventArgs e)
            {
                e.Graphics.Clear(Parent == null ? Color.FromArgb(21, 21, 23) : Parent.BackColor);
                e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
                int radius = Math.Max(8, (int)(Height * .28));
                using (GraphicsPath shape = WaveBadge.RoundedPath(new Rectangle(1, 1, Width - 3, Height - 3), radius))
                using (Brush fill = new SolidBrush(pressed ? FlatAppearance.MouseDownBackColor : hovered ? FlatAppearance.MouseOverBackColor : BackColor))
                using (Pen edge = new Pen(Focused ? Color.FromArgb(138, 138, 148) : FlatAppearance.BorderColor))
                { e.Graphics.FillPath(fill, shape); e.Graphics.DrawPath(edge, shape); }
                TextRenderer.DrawText(e.Graphics, Text, Font, ClientRectangle, Enabled ? ForeColor : Color.FromArgb(100, 100, 106), TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine);
            }
        }

        // 深色下拉菜单配色（避免系统默认的扎眼白底）
        private sealed class DarkColorTable : ProfessionalColorTable
        {
            public override Color ToolStripDropDownBackground { get { return Color.FromArgb(28, 28, 30); } }
            public override Color ImageMarginGradientBegin { get { return Color.FromArgb(28, 28, 30); } }
            public override Color ImageMarginGradientMiddle { get { return Color.FromArgb(28, 28, 30); } }
            public override Color ImageMarginGradientEnd { get { return Color.FromArgb(28, 28, 30); } }
            public override Color MenuBorder { get { return Color.FromArgb(44, 44, 46); } }
            public override Color MenuItemBorder { get { return Color.FromArgb(44, 44, 46); } }
            public override Color MenuItemSelected { get { return Color.FromArgb(47, 47, 51); } }
            public override Color MenuItemSelectedGradientBegin { get { return Color.FromArgb(47, 47, 51); } }
            public override Color MenuItemSelectedGradientEnd { get { return Color.FromArgb(47, 47, 51); } }
            public override Color MenuItemPressedGradientBegin { get { return Color.FromArgb(47, 47, 51); } }
            public override Color MenuItemPressedGradientEnd { get { return Color.FromArgb(47, 47, 51); } }
            public override Color SeparatorDark { get { return Color.FromArgb(44, 44, 46); } }
            public override Color SeparatorLight { get { return Color.FromArgb(44, 44, 46); } }
        }
    }
}
