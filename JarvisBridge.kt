package com.sonic.app

import android.content.Context
import android.webkit.JavascriptInterface
import org.json.JSONObject

// Called from the web app as: JSON.parse(window.JarvisNative.run(JSON.stringify({action: "flashlight", on: true})))
class JarvisBridge(private val ctx: Context) {

    @JavascriptInterface
    fun run(json: String): String {
        return try {
            PhoneControl.run(ctx, JSONObject(json)).toString()
        } catch (e: Exception) {
            JSONObject().put("ok", false).put("message", "Bad request").toString()
        }
    }
}
