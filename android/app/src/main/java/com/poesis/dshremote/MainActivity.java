package com.poesis.dshremote;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.os.Bundle;
import android.view.KeyEvent;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.CookieManager;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.webkit.WebViewAssetLoader;

/**
 * DSH Remote：用 WebView 承载单文件 PWA（assets/index.html）。
 * 通过 WebViewAssetLoader 以 https://appassets.androidplatform.net 安全源加载，
 * 保证 WebCrypto（AES-GCM 端到端加密）在 WebView 中可用。
 */
public class MainActivity extends Activity {

    private WebView web;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        web = new WebView(this);
        web.setBackgroundColor(0xFF0B0C0F);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true); // localStorage 保存配对码
        s.setTextZoom(100);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
        WebView.setWebContentsDebuggingEnabled(false);

        WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return loader.shouldInterceptRequest(request.getUrl());
            }
        });

        web.loadUrl("https://appassets.androidplatform.net/assets/index.html");
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK && web != null) {
            // 优先关闭网页内的会话/确认面板，避免 Android 返回键直接退出 App。
            web.evaluateJavascript(
                    "(() => {"
                            + "const confirm = document.querySelector('#confirm-modal.open');"
                            + "if (confirm) { document.getElementById('confirm-cancel')?.click(); return true; }"
                            + "const usage = document.querySelector('#usage-modal.open');"
                            + "if (usage) { document.querySelector('#usage-close').click(); return true; }"
                            + "const sessions = document.querySelector('#session-modal.open');"
                            + "if (sessions) { document.getElementById('session-close')?.click(); return true; }"
                            + "return false;"
                            + "})()",
                    handled -> {
                        if (!"true".equals(handled)) {
                            if (web != null && web.canGoBack()) web.goBack();
                            else finish();
                        }
                    });
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.stopLoading();
            web.loadUrl("about:blank");
            web.removeAllViews();
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
