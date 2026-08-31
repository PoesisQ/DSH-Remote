package com.poesis.dshremote;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.graphics.Rect;
import android.os.Build;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.ViewTreeObserver;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.CookieManager;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import androidx.webkit.WebViewAssetLoader;

/**
 * DSH Remote：用 WebView 承载单文件 PWA（assets/index.html）。
 * 通过 WebViewAssetLoader 以 https://appassets.androidplatform.net 安全源加载，
 * 保证 WebCrypto（AES-GCM 端到端加密）在 WebView 中可用。
 */
public class MainActivity extends Activity {

    private WebView web;
    private FrameLayout root;
    private ViewTreeObserver.OnGlobalLayoutListener imeLayoutListener;
    private int appliedImeBottomMargin;
    private boolean imeVisibilityKnown;
    private boolean imeVisible;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);

        root = new FrameLayout(this);
        root.setBackgroundColor(0xFF0B0C0F);

        web = new WebView(this);
        web.setBackgroundColor(0xFF0B0C0F);
        root.addView(web, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);
        installImeAvoidance();

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

    /**
     * WebView only forwards IME overlap to the visual viewport on sufficiently
     * recent WebView builds.  Older/vendor builds can leave the measured WebView
     * behind the keyboard even with adjustResize.  Measure the real visible frame
     * and remove only the part of this WebView that is physically covered.
     *
     * We do not consume WindowInsets: modern WebViews still receive their normal
     * inset updates, and the fallback converges to zero margin whenever Android
     * already resized the activity for us.
     */
    private void installImeAvoidance() {
        imeLayoutListener = this::updateImeAvoidance;
        root.getViewTreeObserver().addOnGlobalLayoutListener(imeLayoutListener);
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                imeVisibilityKnown = true;
                imeVisible = insets.isVisible(WindowInsets.Type.ime());
            }
            view.post(this::updateImeAvoidance);
            return insets;
        });
    }

    private void updateImeAvoidance() {
        if (root == null || web == null || root.getHeight() <= 0) return;

        Rect visible = new Rect();
        root.getWindowVisibleDisplayFrame(visible);
        int[] location = new int[2];
        root.getLocationOnScreen(location);
        if (imeVisibilityKnown && !imeVisible) {
            applyImeBottomMargin(0);
            return;
        }
        if (visible.isEmpty() || visible.bottom <= location[1]) return;

        int rootBottom = location[1] + root.getHeight();
        int overlap = Math.max(0, rootBottom - visible.bottom);
        int keyboardThreshold = Math.round(72f * getResources().getDisplayMetrics().density);
        int minimumWebHeight = Math.round(160f * getResources().getDisplayMetrics().density);
        int maximumMargin = Math.max(0, root.getHeight() - minimumWebHeight);
        int desiredMargin = overlap >= keyboardThreshold ? Math.min(overlap, maximumMargin) : 0;
        applyImeBottomMargin(desiredMargin);
    }

    private void applyImeBottomMargin(int desiredMargin) {
        if (web == null) return;
        if (desiredMargin == appliedImeBottomMargin) return;

        appliedImeBottomMargin = desiredMargin;
        FrameLayout.LayoutParams params = (FrameLayout.LayoutParams) web.getLayoutParams();
        params.bottomMargin = desiredMargin;
        web.setLayoutParams(params);
        web.post(() -> web.evaluateJavascript(
                "window.__dshViewportController?.update?.();"
                        + "setTimeout(()=>document.activeElement?.scrollIntoView?.({block:'nearest'}),80);",
                null));
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
        if (root != null && imeLayoutListener != null) {
            ViewTreeObserver observer = root.getViewTreeObserver();
            if (observer.isAlive()) observer.removeOnGlobalLayoutListener(imeLayoutListener);
            root.setOnApplyWindowInsetsListener(null);
            imeLayoutListener = null;
        }
        if (web != null) {
            web.stopLoading();
            web.loadUrl("about:blank");
            web.removeAllViews();
            web.destroy();
            web = null;
        }
        root = null;
        super.onDestroy();
    }
}
