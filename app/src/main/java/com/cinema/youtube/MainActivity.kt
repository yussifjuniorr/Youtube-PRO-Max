package com.cinema.youtube

import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.ActivityInfo
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.util.concurrent.Executors

class MainActivity : AppCompatActivity() {

    private lateinit var rootContainer: FrameLayout
    private lateinit var webView: WebView
    private var customView: View? = null
    private var customViewCallback: WebChromeClient.CustomViewCallback? = null

    private val ioExecutor = Executors.newSingleThreadExecutor()

    private lateinit var cssBundle: String
    private lateinit var shimJs: String
    private lateinit var mainJs: String
    private lateinit var contentJs: String
    private lateinit var mobileAddonJs: String

    companion object {
        private const val HOME_URL = "https://www.youtube.com/?app=desktop"
        private const val DESKTOP_UA =
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        window.statusBarColor = Color.parseColor("#050505")
        window.navigationBarColor = Color.parseColor("#050505")

        loadCinemaAssets()

        rootContainer = FrameLayout(this).apply {
            setBackgroundColor(Color.parseColor("#050505"))
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        }

        webView = WebView(this).apply {
            setBackgroundColor(Color.parseColor("#050505"))
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
        }

        setupWebView(webView)
        rootContainer.addView(webView)
        setContentView(rootContainer)

        setupBackHandler()

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState)
        } else {
            webView.loadUrl(HOME_URL)
        }
    }

    private fun loadCinemaAssets() {
        val styleCss = readAsset("cinema/style.css")
        val mobileCss = readAsset("cinema/mobile_overrides.css")
        cssBundle = styleCss + "\n\n" + mobileCss
        shimJs = readAsset("cinema/shim.js")
        mainJs = readAsset("cinema/main.js")
        contentJs = readAsset("cinema/content.js")
        mobileAddonJs = readAsset("cinema/mobile_addon.js")
    }

    private fun readAsset(path: String): String {
        return assets.open(path).bufferedReader(Charsets.UTF_8).use { it.readText() }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView(wv: WebView) {
        val cm = CookieManager.getInstance()
        cm.setAcceptCookie(true)
        cm.setAcceptThirdPartyCookies(wv, true)

        wv.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            userAgentString = DESKTOP_UA
            mediaPlaybackRequiresUserGesture = false
            useWideViewPort = true
            loadWithOverviewMode = false
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
            javaScriptCanOpenWindowsAutomatically = true
            setSupportMultipleWindows(false)
            mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
            cacheMode = WebSettings.LOAD_DEFAULT
        }

        wv.addJavascriptInterface(CinemaBridge(), "CinemaAndroid")

        wv.webViewClient = object : WebViewClient() {

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val uri = request.url ?: return false
                val scheme = uri.scheme?.lowercase() ?: return false
                val host = uri.host?.lowercase() ?: ""

                if (scheme == "vnd.youtube" || scheme == "intent") {
                    val fallback = uri.getQueryParameter("browser_fallback_url")
                    if (!fallback.isNullOrBlank()) {
                        view.loadUrl(fallback)
                    }
                    return true
                }

                if (scheme != "http" && scheme != "https") {
                    try {
                        startActivity(Intent(Intent.ACTION_VIEW, uri))
                    } catch (_: Exception) {}
                    return true
                }

                if (host == "m.youtube.com") {
                    val desktopUri = uri.buildUpon()
                        .authority("www.youtube.com")
                        .appendQueryParameter("app", "desktop")
                        .build()
                    view.loadUrl(desktopUri.toString())
                    return true
                }

                if (isInAppHost(host)) {
                    return false
                }

                try {
                    startActivity(Intent(Intent.ACTION_VIEW, uri))
                } catch (_: Exception) {}
                return true
            }

            override fun onPageCommitVisible(view: WebView, url: String?) {
                super.onPageCommitVisible(view, url)
                if (shouldInjectCinema(url)) {
                    injectCinemaStyle(view)
                }
            }

            override fun onPageFinished(view: WebView, url: String?) {
                super.onPageFinished(view, url)
                CookieManager.getInstance().flush()
                if (shouldInjectCinema(url)) {
                    injectCinemaStyle(view)
                }
            }
        }

        wv.webChromeClient = object : WebChromeClient() {
            override fun onShowCustomView(view: View?, callback: CustomViewCallback?) {
                if (view == null) return
                if (customView != null) {
                    callback?.onCustomViewHidden()
                    return
                }
                customView = view
                customViewCallback = callback
                webView.visibility = View.GONE
                rootContainer.addView(
                    view,
                    FrameLayout.LayoutParams(
                        FrameLayout.LayoutParams.MATCH_PARENT,
                        FrameLayout.LayoutParams.MATCH_PARENT
                    )
                )
                setFullscreen(true)
            }

            override fun onHideCustomView() {
                exitCustomFullscreen()
            }
        }
    }

    private fun isInAppHost(host: String): Boolean {
        return host == "youtube.com" ||
            host.endsWith(".youtube.com") ||
            host == "youtu.be" ||
            host == "google.com" ||
            host.endsWith(".google.com") ||
            host.endsWith(".gstatic.com") ||
            host.endsWith(".googleusercontent.com")
    }

    private fun shouldInjectCinema(url: String?): Boolean {
        if (url.isNullOrBlank()) return false
        val host = Uri.parse(url).host?.lowercase() ?: return false
        return host == "www.youtube.com" || host == "youtube.com"
    }

    private fun injectCinemaStyle(view: WebView) {
        val quotedCss = JSONObject.quote(cssBundle)
        val cssInjector = """
            (() => {
              if (!document.getElementById('cinema-style-css')) {
                const st = document.createElement('style');
                st.id = 'cinema-style-css';
                st.textContent = $quotedCss;
                (document.head || document.documentElement).appendChild(st);
              }
            })();
        """.trimIndent()

        view.evaluateJavascript(cssInjector, null)
        view.evaluateJavascript(shimJs, null)
        view.evaluateJavascript(mainJs, null)
        view.evaluateJavascript(contentJs, null)
        view.evaluateJavascript(mobileAddonJs, null)
    }

    private fun exitCustomFullscreen() {
        val cv = customView ?: return
        rootContainer.removeView(cv)
        customView = null
        webView.visibility = View.VISIBLE
        customViewCallback?.onCustomViewHidden()
        customViewCallback = null
        setFullscreen(false)
        requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
    }

    private fun setFullscreen(enabled: Boolean) {
        val controller = WindowCompat.getInsetsController(window, window.decorView)
        if (enabled) {
            controller.systemBarsBehavior =
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            controller.hide(WindowInsetsCompat.Type.systemBars())
        } else {
            controller.show(WindowInsetsCompat.Type.systemBars())
        }
    }

    private fun setupBackHandler() {
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (customView != null) {
                    exitCustomFullscreen()
                    return
                }
                webView.evaluateJavascript(
                    "(function(){ return window.__cinemaHandleBack ? window.__cinemaHandleBack() : 'back'; })()"
                ) { result ->
                    if (result != "\"handled\"") {
                        if (webView.canGoBack()) {
                            webView.goBack()
                        } else {
                            isEnabled = false
                            onBackPressedDispatcher.onBackPressed()
                        }
                    }
                }
            }
        })
    }

    inner class CinemaBridge {
        @JavascriptInterface
        fun fetchSuggestions(query: String, hl: String, callbackId: String) {
            ioExecutor.execute {
                val suggestions = JSONArray()
                try {
                    val encodedQ = URLEncoder.encode(query, "UTF-8")
                    val encodedHl = URLEncoder.encode(hl.ifBlank { "en" }, "UTF-8")
                    val apiUrl =
                        "https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&oe=utf-8&hl=$encodedHl&q=$encodedQ"
                    val conn = (URL(apiUrl).openConnection() as HttpURLConnection).apply {
                        requestMethod = "GET"
                        connectTimeout = 5000
                        readTimeout = 5000
                        setRequestProperty("User-Agent", DESKTOP_UA)
                    }
                    if (conn.responseCode == 200) {
                        val text = conn.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
                        val parsed = JSONArray(text)
                        if (parsed.length() > 1) {
                            val arr = parsed.getJSONArray(1)
                            for (i in 0 until arr.length()) {
                                suggestions.put(arr.getString(i))
                            }
                        }
                    }
                    conn.disconnect()
                } catch (_: Exception) {
                }

                val jsId = JSONObject.quote(callbackId)
                val jsList = suggestions.toString()
                webView.post {
                    webView.evaluateJavascript(
                        "if (window.__cinemaResolveSuggest) window.__cinemaResolveSuggest($jsId, $jsList);",
                        null
                    )
                }
            }
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    override fun onPause() {
        super.onPause()
        CookieManager.getInstance().flush()
    }

    override fun onDestroy() {
        ioExecutor.shutdownNow()
        webView.destroy()
        super.onDestroy()
    }
}
