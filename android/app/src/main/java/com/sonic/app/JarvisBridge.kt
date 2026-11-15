package com.sonic.app

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONObject

// Bridge between the SONIC web page and Android.
// The web page calls: window.JarvisNative.run(json), startListening(lang), stopListening()
// Android calls back into the web page: window.onNativeSpeech(text), window.onNativeSpeechError(code)
class JarvisBridge(private val ctx: Context, private val web: WebView) {

    private val main = Handler(Looper.getMainLooper())
    private var recognizer: SpeechRecognizer? = null

    @JavascriptInterface
    fun run(json: String): String {
        return try {
            PhoneControl.run(ctx, JSONObject(json)).toString()
        } catch (e: Exception) {
            JSONObject().put("ok", false).put("message", "Bad request").toString()
        }
    }

    @JavascriptInterface
    fun startListening(lang: String) {
        main.post {
            if (!SpeechRecognizer.isRecognitionAvailable(ctx)) {
                sendError("unsupported")
                return@post
            }
            release()
            val r = SpeechRecognizer.createSpeechRecognizer(ctx)
            recognizer = r
            r.setRecognitionListener(listener)
            val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                putExtra(RecognizerIntent.EXTRA_LANGUAGE, safeLang(lang))
                putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false)
                putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
            }
            r.startListening(intent)
        }
    }

    @JavascriptInterface
    fun stopListening() {
        main.post { release() }
    }

    private val listener = object : RecognitionListener {
        override fun onResults(results: Bundle?) {
            val text = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull() ?: ""
            release()
            sendText(text)
        }

        override fun onError(error: Int) {
            release()
            sendError(errorName(error))
        }

        override fun onReadyForSpeech(params: Bundle?) {}
        override fun onBeginningOfSpeech() {}
        override fun onRmsChanged(rmsdB: Float) {}
        override fun onBufferReceived(buffer: ByteArray?) {}
        override fun onEndOfSpeech() {}
        override fun onPartialResults(partialResults: Bundle?) {}
        override fun onEvent(eventType: Int, params: Bundle?) {}
    }

    private fun release() {
        recognizer?.destroy()
        recognizer = null
    }

    // Only these three language codes are allowed. Anything else falls back to Hindi.
    private fun safeLang(lang: String): String =
        if (lang == "hi-IN" || lang == "en-IN" || lang == "en-US") lang else "hi-IN"

    private fun sendText(text: String) {
        main.post {
            web.evaluateJavascript(
                "window.onNativeSpeech && window.onNativeSpeech(" + JSONObject.quote(text) + ");", null
            )
        }
    }

    private fun sendError(code: String) {
        main.post {
            web.evaluateJavascript(
                "window.onNativeSpeechError && window.onNativeSpeechError(" + JSONObject.quote(code) + ");", null
            )
        }
    }

    private fun errorName(error: Int): String = when (error) {
        SpeechRecognizer.ERROR_NO_MATCH -> "no-match"
        SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "no-speech"
        SpeechRecognizer.ERROR_AUDIO -> "audio"
        SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "network"
        SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "not-allowed"
        SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "busy"
        SpeechRecognizer.ERROR_SERVER -> "server"
        SpeechRecognizer.ERROR_CLIENT -> "client"
        else -> "error-$error"
    }
}
