#!/usr/bin/env bash
# 构建 Android APK（WebView 封装 PWA）。
# Machine paths are supplied via .runtime.env or the standard SDK environment.
set -euo pipefail
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$PROJECT_ROOT/scripts/runtime.sh"
if [ -n "${DSH_REMOTE_ANDROID_TOOLCHAIN:-}" ]; then
  export JAVA_HOME="$DSH_REMOTE_ANDROID_TOOLCHAIN/jdk"
  export ANDROID_HOME="$DSH_REMOTE_ANDROID_TOOLCHAIN/sdk"
  export PATH="$DSH_REMOTE_ANDROID_TOOLCHAIN/gradle-8.7/bin:$PATH"
fi
if [ -z "${JAVA_HOME:-}" ] || [ -z "${ANDROID_HOME:-}" ]; then
  echo "请配置 JAVA_HOME / ANDROID_HOME 或 DSH_REMOTE_ANDROID_TOOLCHAIN" >&2
  exit 1
fi
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"
command -v gradle >/dev/null || { echo "找不到 Gradle 8.7，请配置 PATH" >&2; exit 1; }

# 1) 安装缺失的 SDK 组件（首次）
if [ ! -d "$ANDROID_HOME/platforms/android-35" ] || [ ! -d "$ANDROID_HOME/build-tools/35.0.0" ]; then
  echo '缺少 Android SDK 35；请先运行 sdkmanager "platforms;android-35" "build-tools;35.0.0" 并确认许可证' >&2
  exit 1
fi

# 2) 同步 PWA 到 assets（build-pwa 同时更新 Vercel 静态入口）
cd "$PROJECT_ROOT"
node scripts/build-pwa.mjs
APP_VERSION="$(node --input-type=module -e 'import fs from "node:fs"; console.log(JSON.parse(fs.readFileSync("package.json")).version)')"

# 3) 构建
cd android
GRADLE_ARGS=(--no-daemon)
if [ "${DSH_REMOTE_GRADLE_OFFLINE:-0}" = "1" ]; then GRADLE_ARGS+=(--offline); fi
gradle "${GRADLE_ARGS[@]}" assembleDebug

APK="$PROJECT_ROOT/android/app/build/outputs/apk/debug/app-debug.apk"
DIST="$PROJECT_ROOT/dist/DSH-Remote-v$APP_VERSION.apk"
mkdir -p "$(dirname "$DIST")"
cp "$APK" "$DIST"
echo ""
echo "✅ APK 已生成: $APK ($(du -h "$APK" | cut -f1))"
echo "   发布副本: $DIST"
echo "   安装: adb install -r $APK"
