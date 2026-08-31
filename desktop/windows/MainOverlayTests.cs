using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Threading;
using System.Windows.Forms;
namespace DshDesktop
{
    internal static class MainOverlayTests
    {
        private static Exception lastError;

        [STAThread]
        private static int Main()
        {
            try {
                Application.EnableVisualStyles();
                // 测试环境无安装目录：写入最小合法设置（仅本进程目录，不影响真实安装）
                File.WriteAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "desktop.settings.json"),
                    "{\"Distro\":\"Ubuntu\",\"BackendRoot\":\"/tmp\",\"ProfilePath\":\"\",\"DshUrl\":\"http://127.0.0.1:3080/\",\"RelayUrl\":\"\",\"StopOnClose\":true}");
                DesktopSettings.Load();
                // 测试环境：禁用关窗即停与模态错误框，避免挂死
                DesktopSettings.Current.StopOnClose = false;
                MainForm.QuietErrors = true;

                lastError = null;
                using (var form = new MainForm(null)) {
                    form.StartPosition = FormStartPosition.Manual;
                    form.Location = new Point(-32000, -32000);
                    form.Shown += delegate { RunChecks(form); };
                    Application.Run(form);
                }
                if (lastError != null) throw lastError;
                Console.WriteLine("Main-window overlay animation, centering, clock and error tests passed."); return 0;
            } catch (Exception ex) { Console.Error.WriteLine(ex.Message); return 1; }
        }

        private static void RunChecks(MainForm form)
        {
            try {
                Control badge = form.Controls["startup-badge"];
                Control status = form.Controls["startup-status"];
                string[] buttons = { "startup-retry", "startup-log", "startup-quit" };

                // 热启动：覆盖层全部隐藏
                if (badge == null) throw new Exception("overlay badge missing");
                if (badge.Visible || status.Visible) throw new Exception("overlay must stay hidden on hot start");
                foreach (string n in buttons) if (form.Controls[n].Visible) throw new Exception("buttons hidden on hot start: " + n);

                // 冷启动：图标动画显示且居中（大窗口正中央）
                form.StartColdBoot(false);
                if (!badge.Visible || !form.ProgressRunning) throw new Exception("cold boot should show animated badge");
                if (status.Visible) throw new Exception("status hidden during cold boot");
                var r = badge.Bounds; var c = form.ClientRectangle;
                if (Math.Abs((r.Left + r.Width / 2) - c.Width / 2) > 4) throw new Exception("badge not horizontally centered");

                // 单调时钟推进（超时逻辑依赖）
                var clock = (Stopwatch)typeof(MainForm).GetField("startupClock", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(form);
                clock.Start(); Thread.Sleep(1050);
                typeof(MainForm).GetMethod("OnStartupTick", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(form, new object[] { null, EventArgs.Empty });
                if (clock.Elapsed.TotalSeconds < 1.0) throw new Exception("monotonic clock did not advance");

                // 错误态：图标隐藏、动画停止、文字与按钮就位
                form.ShowStartupError("启动未完成\n请重试，或查看日志了解原因");
                if (form.ProgressRunning || badge.Visible) throw new Exception("error must hide badge");
                if (!status.Visible) throw new Exception("error must show status");
                if (status.Height < status.Font.Height * 2) throw new Exception("error text needs two lines");
                foreach (string n in buttons) {
                    Control b = form.Controls[n];
                    if (!b.Visible || !form.ClientRectangle.Contains(b.Bounds)) throw new Exception("error button hidden or outside: " + n);
                }

                // 重试：恢复图标动画态
                form.ResetStartup();
                if (!form.ProgressRunning || !badge.Visible) throw new Exception("retry must restore badge");
                if (status.Visible) throw new Exception("status must hide after retry");
            } catch (Exception ex) { lastError = ex; }
            finally {
                try { form.Close(); } catch { }
                Application.ExitThread();
            }
        }
    }
}
