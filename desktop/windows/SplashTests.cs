using System;
using System.Diagnostics;
using System.Reflection;
using System.Threading;
using System.Windows.Forms;
namespace DshDesktop
{
    internal static class SplashTests
    {
        [STAThread]
        private static int Main()
        {
            try {
                Application.EnableVisualStyles();
                using (var form = new SplashForm(null, false)) {
                    string[] names = { "startup-status", "startup-progress", "startup-elapsed", "startup-retry", "startup-log", "startup-quit" };
                    foreach (string name in names) {
                        Control control = form.Controls[name];
                        if (control == null || !form.ClientRectangle.Contains(control.Bounds)) throw new Exception("Control outside splash: " + name);
                        foreach (string other in names) if (other != name && control.Bounds.IntersectsWith(form.Controls[other].Bounds)) throw new Exception("Overlapping startup controls: " + name + "/" + other);
                    }
                    if (!form.ProgressRunning) throw new Exception("Progress should animate during startup");
                    var clock = (Stopwatch)typeof(SplashForm).GetField("startupClock", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(form);
                    clock.Start(); Thread.Sleep(1050);
                    typeof(SplashForm).GetMethod("OnTick", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(form, new object[] { null, EventArgs.Empty });
                    if (!form.Controls["startup-elapsed"].Text.StartsWith("已用时 1.")) throw new Exception("Elapsed time did not advance");
                    form.ShowError("启动未完成\n请重试，或查看日志了解原因");
                    if (form.ProgressRunning || !form.Controls["startup-elapsed"].Text.StartsWith("启动已暂停")) throw new Exception("Failure must be explicitly paused");
                    if (form.Controls["startup-status"].Height < form.Controls["startup-status"].Font.Height * 2) throw new Exception("Error text needs two lines");
                }
                Console.WriteLine("Splash layout, animation state and elapsed-time tests passed."); return 0;
            } catch (Exception ex) { Console.Error.WriteLine(ex.Message); return 1; }
        }
    }
}
