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
        private SplashForm splash;
        private bool restarting;

        internal DshAppContext()
        {
            focusEvent = new EventWaitHandle(false, EventResetMode.AutoReset, Program.FocusEventName);
            Thread t = new Thread(FocusLoop);
            t.IsBackground = true;
            t.Start();

            StartWithSplash(); // Start the supervisor/bridge even when an existing DSH is reused.
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

        internal void StartWithSplash()
        {
            splash = new SplashForm(this);
            splash.Show();
        }

        internal void OnStartupReady(SplashForm s)
        {
            if (splash == s) splash = null;
            s.Dispose();
            ShowMain();
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
                if (PortUp()) ShowMain(); else StartWithSplash();
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
            if (splash != null && !splash.IsDisposed) splash.Dispose();
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

    internal sealed class SplashForm : Form
    {
        private const int TimeoutSeconds = 180;
        private const int CornerRadius = 18;

        private DshAppContext owner;
        private Label statusLabel, elapsedLabel;
        private SlideBar bar;
        private Button retryButton, logButton, quitButton;
        private System.Windows.Forms.Timer timer, fadeTimer;
        private readonly Stopwatch startupClock = new Stopwatch();
        private readonly bool launchBackend;
        private Process startProcess;
        private volatile bool backendReady;
        private bool startSucceeded;
        private float dpiScale = 1f;

        internal SplashForm(DshAppContext owner, bool launchBackend = true)
        {
            this.owner = owner;
            this.launchBackend = launchBackend;
            Text = "DS Harness";
            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.CenterScreen;
            ShowInTaskbar = true;
            AutoScaleMode = AutoScaleMode.None; // Bounds below are already scaled for DPI.

            // 显式 DPI 缩放：字体按物理点数随 DPI 变大，坐标必须同步缩放，
            // 否则高缩放比（150%/175%/200%）下标签互相遮挡、文字被裁。
            using (Graphics g = Graphics.FromHwnd(IntPtr.Zero)) { dpiScale = g.DpiX / 96f; }
            Func<int, int> S = delegate(int v) { return (int)Math.Round(v * dpiScale); };

            ClientSize = new Size(S(400), S(292));
            BackColor = Color.FromArgb(21, 21, 23);
            DoubleBuffered = true;
            Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
            Load += OnLoad;

            PictureBox iconBox = new PictureBox();
            string logo = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "splash-logo.png");
            iconBox.Image = File.Exists(logo) ? Image.FromFile(logo) : Icon.ToBitmap();
            iconBox.Disposed += delegate { if (iconBox.Image != null) iconBox.Image.Dispose(); };
            iconBox.SizeMode = PictureBoxSizeMode.Zoom;
            iconBox.Bounds = new Rectangle(S(176), S(26), S(48), S(48));
            iconBox.BackColor = Color.FromArgb(21, 21, 23);
            Controls.Add(iconBox);

            Label titleLabel = new Label();
            titleLabel.Text = "DS Harness";
            titleLabel.Font = new Font("Segoe UI Light", 17f);
            titleLabel.ForeColor = Color.FromArgb(232, 234, 237);
            titleLabel.BackColor = Color.FromArgb(21, 21, 23);
            titleLabel.Size = new Size(S(240), S(32));
            titleLabel.TextAlign = ContentAlignment.MiddleCenter;
            titleLabel.Location = new Point(S(80), S(84));
            Controls.Add(titleLabel);

            statusLabel = new Label();
            statusLabel.Name = "startup-status";
            statusLabel.Text = "正在唤醒 WSL 子系统…";
            statusLabel.Font = new Font("Segoe UI Semilight", 10f);
            statusLabel.ForeColor = Color.FromArgb(154, 160, 166);
            statusLabel.BackColor = Color.FromArgb(21, 21, 23);
            statusLabel.Size = new Size(S(352), S(42));
            statusLabel.TextAlign = ContentAlignment.MiddleCenter;
            statusLabel.Location = new Point(S(24), S(126));
            Controls.Add(statusLabel);

            bar = new SlideBar();
            bar.Name = "startup-progress";
            bar.Bounds = new Rectangle(S(96), S(184), S(208), Math.Max(3, S(3)));
            Controls.Add(bar);

            elapsedLabel = new Label();
            elapsedLabel.Name = "startup-elapsed";
            elapsedLabel.Text = "正在准备…";
            elapsedLabel.Font = new Font("Segoe UI Light", 9f);
            elapsedLabel.ForeColor = Color.FromArgb(97, 102, 107);
            elapsedLabel.BackColor = Color.FromArgb(21, 21, 23);
            elapsedLabel.Size = new Size(S(352), S(22));
            elapsedLabel.TextAlign = ContentAlignment.MiddleCenter;
            elapsedLabel.Location = new Point(S(24), S(198));
            Controls.Add(elapsedLabel);

            retryButton = MakeFlatButton("重新启动", S(38), S(236), S(102), S(34));
            retryButton.Name = "startup-retry";
            retryButton.Click += OnRetry;
            Controls.Add(retryButton);

            logButton = MakeFlatButton("查看日志", S(150), S(236), S(102), S(34));
            logButton.Name = "startup-log";
            logButton.Click += OnLog;
            Controls.Add(logButton);

            quitButton = MakeFlatButton("退出", S(262), S(236), S(100), S(34));
            quitButton.Name = "startup-quit";
            quitButton.Click += OnQuit;
            Controls.Add(quitButton);

            timer = new System.Windows.Forms.Timer();
            timer.Interval = 200;
            timer.Tick += OnTick;

            // 窗口淡入动画（标签均为实色背景，分层窗口渲染安全）
            Opacity = 0.0;
            fadeTimer = new System.Windows.Forms.Timer();
            fadeTimer.Interval = 40;
            fadeTimer.Tick += delegate
            {
                Opacity += 0.2;
                if (Opacity >= 1.0) { Opacity = 1.0; fadeTimer.Stop(); }
            };
            fadeTimer.Start();
        }

        private static Button MakeFlatButton(string text, int x, int y, int w, int h)
        {
            Button b = new QuietButton();
            b.Text = text;
            b.FlatStyle = FlatStyle.Flat;
            b.FlatAppearance.BorderColor = Color.FromArgb(62, 62, 66);
            b.FlatAppearance.MouseOverBackColor = Color.FromArgb(47, 47, 51);
            b.FlatAppearance.MouseDownBackColor = Color.FromArgb(55, 55, 59);
            b.BackColor = Color.FromArgb(34, 34, 37);
            b.ForeColor = Color.FromArgb(216, 216, 221);
            b.Font = new Font("Segoe UI Semilight", 9.5f);
            b.Location = new Point(x, y);
            b.Size = new Size(w, h);
            b.UseVisualStyleBackColor = false;
            b.Visible = false;
            b.TabStop = true;
            return b;
        }

        [DllImport("dwmapi.dll")]
        private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);

        private const int DwmWindowCornerPreference = 33;
        private const int DwmRoundCorners = 2;

        private void OnLoad(object sender, EventArgs e)
        {
            // Win11 原生圆角 + 阴影（替代手绘 Region，避免高 DPI 下裁剪错位）
            try
            {
                int pref = DwmRoundCorners;
                DwmSetWindowAttribute(Handle, DwmWindowCornerPreference, ref pref, sizeof(int));
            }
            catch { }
            startupClock.Restart();
            timer.Start();
            if (launchBackend) LaunchStartProcess();
        }

        private static GraphicsPath MakeRoundedPath(Rectangle r, int radius)
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

        protected override void OnPaint(PaintEventArgs e)
        {
            base.OnPaint(e);
            Graphics g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            using (Pen pen = new Pen(Color.FromArgb(58, 58, 62)))
                g.DrawPath(pen, MakeRoundedPath(new Rectangle(0, 0, Width - 1, Height - 1),
                    (int)Math.Round(CornerRadius * dpiScale)));
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
                e.Graphics.Clear(Parent == null ? Color.FromArgb(21,21,23) : Parent.BackColor);
                e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
                int radius = Math.Max(8, (int)(Height * .28));
                using (GraphicsPath shape = MakeRoundedPath(new Rectangle(1,1,Width-3,Height-3), radius))
                using (Brush fill = new SolidBrush(pressed ? FlatAppearance.MouseDownBackColor : hovered ? FlatAppearance.MouseOverBackColor : BackColor))
                using (Pen edge = new Pen(Focused ? Color.FromArgb(138,138,148) : FlatAppearance.BorderColor))
                { e.Graphics.FillPath(fill, shape); e.Graphics.DrawPath(edge, shape); }
                TextRenderer.DrawText(e.Graphics, Text, Font, ClientRectangle, Enabled ? ForeColor : Color.FromArgb(100,100,106), TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine);
            }
        }

        internal bool ProgressRunning { get { return bar.Running; } }

        protected override void Dispose(bool disposing)
        {
            if (disposing) {
                startupClock.Stop();
                if (timer != null) { timer.Stop(); timer.Dispose(); }
                if (fadeTimer != null) { fadeTimer.Stop(); fadeTimer.Dispose(); }
            }
            base.Dispose(disposing);
        }

        private sealed class SlideBar : Control
        {
            private double phase;
            private System.Windows.Forms.Timer anim;
            private bool running = true;
            internal bool Running { get { return running; } set { running = value; if (value) anim.Start(); else anim.Stop(); Invalidate(); } }

            internal SlideBar()
            {
                SetStyle(ControlStyles.OptimizedDoubleBuffer | ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint, true);
                Height = 4;
                anim = new System.Windows.Forms.Timer();
                anim.Interval = 33;
                anim.Tick += delegate { phase += 0.045; Invalidate(); };
                anim.Start();
            }

            protected override void Dispose(bool disposing)
            {
                if (disposing) { anim.Stop(); anim.Dispose(); }
                base.Dispose(disposing);
            }

            protected override void OnPaint(PaintEventArgs e)
            {
                base.OnPaint(e);
                Graphics g = e.Graphics;
                g.SmoothingMode = SmoothingMode.AntiAlias;
                using (SolidBrush track = new SolidBrush(Color.FromArgb(46, 46, 50)))
                    g.FillRectangle(track, new Rectangle(0, 0, Width, Height));
                if (!running || Width < 3 || Height < 1) return;
                int segW = Math.Max(40, (int)(Width * 0.37));
                int maxX = Math.Max(0, Width - segW);
                double d = 0.5 - 0.5 * Math.Cos(phase * Math.PI);
                int x = (int)(d * maxX);
                Rectangle seg = new Rectangle(x, 0, Math.Min(segW, Width), Height);
                using (LinearGradientBrush gb = new LinearGradientBrush(seg, Color.FromArgb(96, 165, 250), Color.FromArgb(59, 130, 246), 0f))
                    g.FillRectangle(gb, seg);
            }
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
                try { lock (typeof(SplashForm)) {
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
            catch (Exception ex) { ShowError("无法启动 WSL: " + ex.Message); }
        }

        private void OnTick(object sender, EventArgs e)
        {
            UpdateElapsed(false);
            if (startSucceeded && startProcess.HasExited) { ShowError("启动未完成\n请重试，或查看日志了解原因"); return; }
            int sec = (int)startupClock.Elapsed.TotalSeconds;
            if (sec < 8) statusLabel.Text = "正在唤醒 WSL 子系统…";
            else if (sec < 120) statusLabel.Text = "正在启动 DS Harness…";
            else statusLabel.Text = "即将就绪，请稍候…";

            if (backendReady && DshAppContext.PortUp())
            {
                timer.Stop();
                owner.OnStartupReady(this);
                return;
            }
            if (sec >= TimeoutSeconds)
            {
                timer.Stop();
                ShowError("启动超时（" + TimeoutSeconds.ToString() + " 秒），请查看日志确认原因。");
            }
        }

        private void UpdateElapsed(bool paused)
        {
            double seconds = startupClock.Elapsed.TotalSeconds;
            string duration = seconds < 1 ? "不足 1 秒" : seconds.ToString(seconds < 10 ? "0.0" : "0") + " 秒";
            elapsedLabel.Text = (paused ? "启动已暂停 · 用时 " : "已用时 ") + duration;
        }

        internal void ShowError(string message)
        {
            timer.Stop();
            startupClock.Stop();
            UpdateElapsed(true);
            bar.Running = false;
            statusLabel.Text = message;
            statusLabel.ForeColor = Color.FromArgb(248, 113, 113);
            retryButton.Visible = true;
            logButton.Visible = true;
            quitButton.Visible = true;
        }

        private void ResetForRetry()
        {
            statusLabel.ForeColor = Color.FromArgb(148, 163, 184);
            statusLabel.Text = "正在唤醒 WSL 子系统…";
            bar.Running = true;
            retryButton.Visible = false;
            logButton.Visible = false;
            quitButton.Visible = false;
        }

        private async void OnRetry(object sender, EventArgs e)
        {
            retryButton.Enabled = logButton.Enabled = quitButton.Enabled = false;
            await Task.Run(new Action(RunStopOnce));
            if (IsDisposed) return;
            retryButton.Enabled = logButton.Enabled = quitButton.Enabled = true;
            try { if (startProcess != null && startProcess.HasExited) startProcess.Dispose(); } catch { }
            ResetForRetry();
            startupClock.Restart();
            timer.Start();
            LaunchStartProcess();
        }

        private void RunStopOnce()
        {
            try
            {
                // A failed duplicate launch must not stop another existing supervisor.
                if (!startSucceeded || startProcess == null || startProcess.HasExited) return;
                using (Process stop = new Process()) {
                stop.StartInfo.FileName = DshAppContext.WslExe;
                stop.StartInfo.Arguments = DesktopSettings.Current.WslArguments("stop");
                stop.StartInfo.UseShellExecute = false;
                stop.StartInfo.CreateNoWindow = true;
                stop.Start();
                stop.WaitForExit(15000);
                }
            }
            catch { }
        }

        private void OnLog(object sender, EventArgs e)
        {
            try { Process.Start("notepad.exe", DesktopSettings.Quote(DshAppContext.LogUncPath)); } catch { }
        }

        private void OnQuit(object sender, EventArgs e)
        {
            RunStopOnce();
            owner.ExitApp();
        }
    }

    internal sealed class MainForm : Form
    {
        private DshAppContext owner;
        private WebView2 webView;
        private Label statusStrip;
        private System.Windows.Forms.Timer watchdog;
        private bool closing;
        private bool skipStop;
        private bool statusBusy;
        private string widgetJs;

        internal bool SkipStop { get { return skipStop; } set { skipStop = value; } }

        internal MainForm(DshAppContext owner)
        {
            this.owner = owner;
            Text = "DS Harness";
            StartPosition = FormStartPosition.CenterScreen;
            float mscale;
            using (Graphics g = Graphics.FromHwnd(IntPtr.Zero)) { mscale = g.DpiX / 96f; }
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

            Load += OnLoad;
            FormClosing += OnFormClosing;
            FormClosed += delegate { if (watchdog != null) watchdog.Dispose(); };
            var menu = new MenuStrip();
            menu.BackColor = Color.FromArgb(28, 28, 30); menu.ForeColor = Color.Gainsboro;
            var remoteMenu = new ToolStripMenuItem("手机互联");
            remoteMenu.DropDownItems.Add("打开手机网页", null, delegate { try { if (string.IsNullOrEmpty(DesktopSettings.Current.RelayUrl)) MessageBox.Show(this, "请在桌面设置文件中填写自己的 RelayUrl。", "互联设置"); else DesktopSettings.OpenExternal(DesktopSettings.Current.RelayUrl); } catch { } });
            remoteMenu.DropDownItems.Add("查看 / 复制配对码", null, async delegate { await ShowPairing(); });
            menu.Items.Add(remoteMenu);
            menu.Items.Add("设置文件", null, delegate { Process.Start("notepad.exe", DesktopSettings.Quote(DesktopSettings.SettingsPath)); });
            menu.Items.Add("启动日志", null, delegate { Process.Start("notepad.exe", DesktopSettings.Quote(DesktopSettings.LogPath)); });
            MainMenuStrip = menu; Controls.Add(menu);
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
                        try { webView.CoreWebView2.ExecuteScriptAsync(widgetJs); } catch { }
                    };
                }
                webView.CoreWebView2.Navigate(DshAppContext.Url);
                LogWidgetEvent("OnLoad:navigated");
                StartWatchdog();
            }
            catch (Exception ex)
            {
                LogWidgetEvent("OnLoad:ERROR " + ex.Message);
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
                dialog.Text = "私密配对码 · 不要公开分享"; dialog.Size = new Size(600, 260); dialog.StartPosition = FormStartPosition.CenterParent;
                var box = new TextBox { Multiline = true, ReadOnly = true, Dock = DockStyle.Fill, Text = value, ScrollBars = ScrollBars.Vertical };
                var copy = new Button { Text = "复制配对码（包含远程控制权限）", Dock = DockStyle.Bottom, Height = 40 };
                copy.Click += delegate { try { Clipboard.SetText(value); copy.Text = "已复制，请粘贴到自己的手机"; } catch { } };
                dialog.Controls.Add(box); dialog.Controls.Add(copy); dialog.ShowDialog(this);
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
    }
}
