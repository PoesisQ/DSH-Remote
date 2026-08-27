using System;
namespace DshDesktop
{
    internal static class SettingsTests
    {
        private static int Main()
        {
            try {
                var s = new DesktopSettings { BackendRoot = "/opt/suite with spaces", ProfilePath = "/tmp/my profile.json" };
                s.Validate(); DesktopSettings.Current = s;
                if (!s.WslArguments("doctor").StartsWith("-d Ubuntu -- ")) throw new Exception("Simple WSL distribution names must not be quoted");
                if (!DesktopSettings.TrustedSource("http://127.0.0.1:3080/path")) throw new Exception("Local source rejected");
                foreach (string url in new string[] { "https://example.com", "http://127.0.0.1.evil.test:3080", "http://127.0.0.1:9999", "file:///tmp/test" }) if (DesktopSettings.TrustedSource(url)) throw new Exception("Untrusted origin accepted");
                if (!s.WslArguments("usage").Contains("\"/opt/suite with spaces/desktop/linux/launcher.sh\"")) throw new Exception("Paths were not quoted");
                bool rejected = false; try { s.WslArguments("stop; anything"); } catch { rejected = true; } if (!rejected) throw new Exception("Invalid action accepted");
                s.RelayUrl = "https://user:secret@example.com"; rejected = false; try { s.Validate(); } catch { rejected = true; } if (!rejected) throw new Exception("Credential-bearing URL accepted");
                Console.WriteLine("Desktop settings / origin / quoting tests passed."); return 0;
            } catch (Exception ex) { Console.Error.WriteLine(ex.Message); return 1; }
        }
    }
}
