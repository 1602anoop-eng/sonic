package com.sonic.app

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONObject
import java.util.Locale

// Bridge between the SONIC web page and Android.
// The web page calls: window.JarvisNative.run(json), startListening(lang), stopListening(), speak(text, lang, rate), stopSpeaking()
// Android calls back into the web page: window.onNativeSpeech(text), window.onNativeSpeechError(code), window.onNativeSpeakDone()
class JarvisBridge(private val ctx: Context, private val web: WebView) {

    private val main = Handler(Looper.getMainLooper())
    private var recognizer: SpeechRecognizer? = null
    private var tts: TextToSpeech? = null
    private var ttsReady = false
    private var utterCount = 0

    init {
        tts = TextToSpeech(ctx) { status ->
            ttsReady = (status == TextToSpeech.SUCCESS)
        }
    }

    @JavascriptInterface
    fun run(json: String): String {
        return try {
            PhoneControl.run(ctx, JSONObject(json)).toString()
        } catch (e: Exception) {
            JSONObject().put("ok", false).put("message", "Bad request").toString()
        }
    }

    // ---------- Speech recognition (mic) ----------

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

    // ---------- Speech output (awaaz) ----------

    // Speaks the text with Android's own Text-to-Speech. The web page waits for onNativeSpeakDone().
    @JavascriptInterface
    fun speak(text: String, lang: String, rate: Double) {
        main.post {
            val engine = tts
            if (engine == null || !ttsReady) {
                sendDone()
                return@post
            }
            engine.language = toLocale(lang)
            // Prefer a female voice if the phone has one for this language
            val want = toLocale(lang)
            val female = engine.voices?.firstOrNull {
                it.locale.language == want.language && it.name.contains("female", ignoreCase = true)
            }
            if (female != null) engine.voice = female
            engine.setSpeechRate(rate.toFloat().coerceIn(0.5f, 1.5f))
            engine.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                override fun onStart(utteranceId: String?) {}
                override fun onDone(utteranceId: String?) { sendDone() }
                @Deprecated("Deprecated in Java")
                override fun onError(utteranceId: String?) { sendDone() }
            })
            utterCount++
            engine.speak(text, TextToSpeech.QUEUE_FLUSH, null, "u$utterCount")
        }
    }

    @JavascriptInterface
    fun stopSpeaking() {
        main.post {
            tts?.stop()
            sendDone()
        }
    }

    private fun toLocale(lang: String): Locale = when (lang) {
        "hi-IN" -> Locale("hi", "IN")
        "en-IN" -> Locale("en", "IN")
        else -> Locale.US
    }

    // ---------- Helpers ----------

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

    private fun sendDone() {
        main.post {
            web.evaluateJavascript("window.onNativeSpeakDone && window.onNativeSpeakDone();", null)
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
