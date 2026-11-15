package com.sonic.app

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import org.json.JSONObject

// Opens the SONIC web app (GitHub Pages) inside the app and gives it phone control, native voice and the background wake word.
class MainActivity : AppCompatActivity() {

    private lateinit var web: WebView
    private var pendingWake: String? = null

    private val askPermissions =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
            // Load the web app after the user answers the permission prompts (allowed or denied)
            web.loadUrl(APP_URL)
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        web = WebView(this)
        setContentView(web)

        val s = web.settings
        s.javaScriptEnabled = true
        s.domStorageEnabled = true
        s.databaseEnabled = true
        s.mediaPlaybackRequiresUserGesture = false
        s.cacheMode = WebSettings.LOAD_DEFAULT

        // Available in the web app as window.JarvisNative
        web.addJavascriptInterface(JarvisBridge(this, web), "JarvisNative")

        // Only the SONIC site loads inside the app. Other links are blocked.
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                return request.url.host != APP_HOST
            }

            // If the app was opened by "Hey SONIC" from the background, pass the words to the page once it is ready
            override fun onPageFinished(view: WebView?, url: String?) {
                pendingWake?.let { deliverWake(it) }
                pendingWake = null
            }
        }

        // Microphone and camera for the web app, only if the user allowed them in Android
        web.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) {
                val micOk = ContextCompat.checkSelfPermission(
                    this@MainActivity, Manifest.permission.RECORD_AUDIO
                ) == PackageManager.PERMISSION_GRANTED
                if (micOk) request.grant(request.resources) else request.deny()
            }
        }

        val perms = mutableListOf(Manifest.permission.RECORD_AUDIO, Manifest.permission.CAMERA)
        if (Build.VERSION.SDK_INT >= 33) perms.add(Manifest.permission.POST_NOTIFICATIONS)
        askPermissions.launch(perms.toTypedArray())

        intent?.getStringExtra(VoiceService.EXTRA_WAKE_TEXT)?.let { pendingWake = it }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        intent.getStringExtra(VoiceService.EXTRA_WAKE_TEXT)?.let { deliverWake(it) }
    }

    override fun onStart() {
        super.onStart()
        VoiceService.appVisible = true
    }

    override fun onStop() {
        VoiceService.appVisible = false
        super.onStop()
    }

    private fun deliverWake(text: String) {
        web.evaluateJavascript("window.onBackgroundWake && window.onBackgroundWake(" + JSONObject.quote(text) + ");", null)
    }

    override fun onBackPressed() {
        if (web.canGoBack()) web.goBack() else super.onBackPressed()
    }

    override fun onDestroy() {
        web.destroy()
        super.onDestroy()
    }

    companion object {
        const val APP_HOST = "1602anoop-eng.github.io"
        const val APP_URL = "https://1602anoop-eng.github.io/sonic/"
    }
}
