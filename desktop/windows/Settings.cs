using System;
using System.IO;
using System.Windows.Forms;
using System.Web.Script.Serialization;

namespace DshDesktop
{
    internal sealed class DesktopSettings
    {
        public string Distro { get; set; }
        public string BackendRoot { get; set; }
        public string ProfilePath { get; set; }
        public string DshUrl { get; set; }
        public string RelayUrl { get; set; }
        public bool StopOnClose { get; set; }
        public DesktopSettings() { Distro = "Ubuntu"; DshUrl = "http://127.0.0.1:3080/"; ProfilePath = ""; RelayUrl = ""; StopOnClose = true; }
        internal static DesktopSettings Current;
        internal static string SettingsPath { get { return Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "desktop.settings.json"); } }
        internal static string LogPath { get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "DSHarness", "suite.log"); } }
        internal static void Load()
        {
            if (!File.Exists(SettingsPath)) throw new Exception("Run Install.ps1 first to configure your WSL distribution and backend folder.");
            Current = new JavaScriptSerializer().Deserialize<DesktopSettings>(File.ReadAllText(SettingsPath));
            if (Current == null) throw new Exception("Invalid desktop settings");
            Current.Validate();
        }
        internal void Validate()
        {
            Uri uri;
            if (!Uri.TryCreate(DshUrl, UriKind.Absolute, out uri) || uri.Scheme != "http" || !(uri.Host == "127.0.0.1" || uri.Host == "localhost" || uri.Host == "[::1]") || uri.AbsolutePath != "/" || uri.UserInfo != "" || uri.Query != "" || uri.Fragment != "") throw new Exception("DSH URL must be a loopback HTTP origin.");
            if (string.IsNullOrWhiteSpace(Distro) || string.IsNullOrWhiteSpace(BackendRoot) || !BackendRoot.StartsWith("/")) throw new Exception("Configure a WSL distribution and an absolute Linux backend path.");
            foreach (string value in new string[] { Distro, BackendRoot, ProfilePath ?? "" }) if (value.IndexOfAny(new char[] { '\0', '\r', '\n' }) >= 0) throw new Exception("Invalid configuration characters");
            if (!string.IsNullOrEmpty(ProfilePath) && !ProfilePath.StartsWith("/")) throw new Exception("ProfilePath must be an absolute Linux path.");
            if (!string.IsNullOrEmpty(RelayUrl) && (!Uri.TryCreate(RelayUrl, UriKind.Absolute, out uri) || uri.Scheme != "https" || uri.UserInfo != "" || uri.Query != "" || uri.Fragment != "")) throw new Exception("Relay URL must be a plain HTTPS URL, without credentials.");
        }
        internal static string Quote(string value)
        {
            // Some WSL builds preserve quotes around a simple distribution name.
            // Keep shell-free identifier/path arguments bare; quote only when required.
            if (System.Text.RegularExpressions.Regex.IsMatch(value, @"^[A-Za-z0-9_./:-]+$")) return value;
            // CommandLineToArgvW-compatible quoting, including spaces and trailing slashes.
            var text = new System.Text.StringBuilder("\""); int slashes = 0;
            foreach (char c in value) { if (c == '\\') { slashes++; continue; } if (c == '"') text.Append('\\', slashes * 2 + 1); else text.Append('\\', slashes); text.Append(c); slashes = 0; }
            text.Append('\\', slashes * 2); return text.Append('"').ToString();
        }
        internal string WslArguments(string action)
        {
            if (Array.IndexOf(new string[] { "run", "stop", "status", "usage", "pairing", "doctor" }, action) < 0) throw new Exception("Unknown backend action");
            return "-d " + Quote(Distro) + " -- bash " + Quote(BackendRoot.TrimEnd('/') + "/desktop/linux/launcher.sh") + " " + action + (string.IsNullOrEmpty(ProfilePath) ? "" : " --config " + Quote(ProfilePath));
        }
        internal static bool TrustedSource(string value)
        {
            Uri source, target;
            return Uri.TryCreate(value, UriKind.Absolute, out source) && Uri.TryCreate(Current.DshUrl, UriKind.Absolute, out target) && source.Scheme == target.Scheme && source.Host == target.Host && source.Port == target.Port && source.UserInfo == "";
        }
        internal static void OpenExternal(string value)
        {
            Uri uri;
            if (Uri.TryCreate(value, UriKind.Absolute, out uri) && (uri.Scheme == "http" || uri.Scheme == "https") && uri.UserInfo == "") System.Diagnostics.Process.Start(uri.AbsoluteUri);
        }
    }
}
