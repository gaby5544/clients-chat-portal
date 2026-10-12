package com.vistra.desk;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.util.ArrayList;
import java.util.List;

/** Vistra — opens the secure transaction desk full-screen. All logic lives on the website; this is the native shell. */
public class MainActivity extends Activity {
    private static final String HOST = "vistra--clientchat--wbl88rcbnqsq.code.run";
    private static final String HOME = "https://" + HOST + "/?source=android";
    private static final int REQ_FILE = 1, REQ_PERM = 2;

    private WebView web;
    private ValueCallback<Uri[]> fileCallback;
    private PermissionRequest pendingWebPermission;

    private static final String OFFLINE =
        "<html><head><meta name='viewport' content='width=device-width,initial-scale=1'></head>"
      + "<body style='margin:0;background:#0a0e18;color:#e5e7eb;font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center'>"
      + "<div style='padding:28px;max-width:340px'><div style='font-size:46px'>&#128737;</div><h2 style='letter-spacing:4px'>VISTRA</h2>"
      + "<p style='color:#9aa4b2;line-height:1.6'>You are offline. Please check your internet connection, then try again.</p>"
      + "<button onclick=\"location.href='" + HOME + "'\" style='width:100%;padding:14px;border:0;border-radius:12px;font-size:16px;font-weight:700;color:#06101c;background:linear-gradient(135deg,#38bdf8,#8b5cf6)'>Try again</button></div></body></html>";

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        web = new WebView(this);
        web.setBackgroundColor(0xFF0A0E18);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setUserAgentString(s.getUserAgentString() + " VistraApp/1.0");
        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        cm.setAcceptThirdPartyCookies(web, true);

        web.setWebViewClient(new WebViewClient() {
            // (API 24+ calls this overload; the API 23 jar used to compile has no such method to override.)
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                return handle(r.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView v, String url) {
                return handle(Uri.parse(url));
            }

            @Override
            public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
                if (r.isForMainFrame()) v.loadDataWithBaseURL(null, OFFLINE, "text/html", "UTF-8", null);
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = cb;
                try {
                    startActivityForResult(params.createIntent(), REQ_FILE);
                } catch (ActivityNotFoundException e) {
                    fileCallback = null;
                    return false;
                }
                return true;
            }

            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(new Runnable() {
                    public void run() { askForWebPermission(request); }
                });
            }
        });

        web.setDownloadListener(new DownloadListener() {
            public void onDownloadStart(String url, String ua, String cd, String mime, long len) {
                openExternal(Uri.parse(url));
            }
        });

        if (saved != null) {
            web.restoreState(saved);
        } else {
            Uri data = getIntent() != null ? getIntent().getData() : null;
            web.loadUrl(data != null && HOST.equals(data.getHost()) ? data.toString() : HOME);
        }
    }

    /** Keep our own site inside the app; send mail, phone and other websites to the right app. */
    private boolean handle(Uri u) {
        String scheme = u.getScheme();
        if ("https".equals(scheme) && HOST.equals(u.getHost())) return false;
        if ("blob".equals(scheme) || "data".equals(scheme) || "about".equals(scheme)) return false;
        openExternal(u);
        return true;
    }

    private void openExternal(Uri u) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, u));
        } catch (ActivityNotFoundException ignored) { }
    }

    /** Camera / microphone for the identity selfie and voice messages: ask Android first, then tell the page. */
    private void askForWebPermission(PermissionRequest request) {
        List<String> needed = new ArrayList<String>();
        for (String res : request.getResources()) {
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(res)) needed.add(Manifest.permission.CAMERA);
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(res)) needed.add(Manifest.permission.RECORD_AUDIO);
        }
        List<String> missing = new ArrayList<String>();
        if (Build.VERSION.SDK_INT >= 23) {
            for (String p : needed) if (checkSelfPermission(p) != PackageManager.PERMISSION_GRANTED) missing.add(p);
        }
        if (missing.isEmpty()) {
            request.grant(request.getResources());
        } else {
            pendingWebPermission = request;
            requestPermissions(missing.toArray(new String[0]), REQ_PERM);
        }
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] results) {
        if (code != REQ_PERM || pendingWebPermission == null) return;
        boolean all = results.length > 0;
        for (int r : results) if (r != PackageManager.PERMISSION_GRANTED) all = false;
        if (all) pendingWebPermission.grant(pendingWebPermission.getResources()); else pendingWebPermission.deny();
        pendingWebPermission = null;
    }

    @Override
    protected void onActivityResult(int code, int result, Intent data) {
        if (code == REQ_FILE && fileCallback != null) {
            fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, data));
            fileCallback = null;
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        Uri d = intent.getData();
        if (d != null && HOST.equals(d.getHost())) web.loadUrl(d.toString());
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack(); else super.onBackPressed();
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override protected void onPause() { super.onPause(); web.onPause(); }
    @Override protected void onResume() { super.onResume(); web.onResume(); }
}
