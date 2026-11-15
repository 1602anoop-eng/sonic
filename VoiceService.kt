package com.sonic.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.speech.RecognitionListener as AndroidRecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import androidx.core.app.NotificationCompat
import org.json.JSONObject
import org.vosk.Model
import org.vosk.Recognizer
import org.vosk.android.RecognitionListener
import org.vosk.android.SpeechService
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.zip.ZipInputStream

// Keeps "Hey SONIC" listening while the app is in the background.
// Engine 1 (offline, free): Vosk. The small English (India) model is downloaded once on first run.
// Engine 2 (fallback): normal speech recognition, used if the Vosk model cannot be loaded.
// A notification is shown while this runs (Android requires it for microphone use in the background).
class VoiceService : Service() {

    private val main = Handler(Looper.getMainLooper())
    private var recognizer: SpeechRecognizer? = null
    private var model: Model? = null
    private var speech: SpeechService? = null
    private var running = false
    private var loadingModel = false
    private var modelFailed = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        instance = this
        createChannels()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            running = false
            main.post { shutdownVosk(); release() }
            stopSelf()
            return START_NOT_STICKY
        }
        startForegroundCompat()
        if (!running) {
            running = true
            main.post { startDetection() }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        running = false
        instance = null
        main.post { shutdownVosk(); release() }
        super.onDestroy()
    }

    // Called by MainActivity: while the SONIC screen is open, the screen listens, so the service steps aside
    fun pauseDetection() {
        main.post {
            try { speech?.stop() } catch (e: Exception) { /* not running */ }
            release()
        }
    }

    fun resumeDetection() {
        main.post { startDetection() }
    }

    private fun startDetection() {
        if (!running) return
        if (appVisible) {
            main.postDelayed({ startDetection() }, 1000)
            return
        }
        val m = model
        if (m != null) {
            startVosk(m)
            return
        }
        if (loadingModel) {
            main.postDelayed({ startDetection() }, 1500)
            return
        }
        if (modelFailed) {
            listenOnce()
            return
        }
        loadModel()
    }

    private fun startForegroundCompat() {
        val n = buildNotification()
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(NOTIF_ID, n, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
        } else {
            startForeground(NOTIF_ID, n)
        }
    }

    private fun buildNotification(): Notification {
        val open = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentTitle("SONIC")
            .setContentText("\"Hey SONIC\" ka intezaar hai")
            .setContentIntent(open)
            .setOngoing(true)
            .build()
    }

    private fun createChannels() {
        if (Build.VERSION.SDK_INT >= 26) {
            val nm = getSystemService(NotificationManager::class.java)
            nm.createNotificationChannel(NotificationChannel(CHANNEL_ID, "SONIC voice", NotificationManager.IMPORTANCE_LOW))
            nm.createNotificationChannel(NotificationChannel(ALERT_CHANNEL, "SONIC wake", NotificationManager.IMPORTANCE_HIGH))
        }
    }

    // ---------- Engine 1: Vosk (offline wake word) ----------

    // Downloads the model once (in a background thread), then starts listening
    private fun loadModel() {
        loadingModel = true
        Thread {
            var ok = false
            try {
                val root = File(filesDir, "vosk")
                root.mkdirs()
                var dir = findModelDir(root)
                if (dir == null) {
                    val zip = File(root, "model.zip")
                    downloadTo(MODEL_URL, zip)
                    unzip(zip, root)
                    zip.delete()
                    dir = findModelDir(root)
                }
                if (dir != null) {
                    model = Model(dir.absolutePath)
                    ok = true
                }
            } catch (e: Exception) {
                ok = false
            }
            loadingModel = false
            modelFailed = !ok
            main.post { startDetection() }
        }.start()
    }

    private fun findModelDir(root: File): File? =
        root.listFiles()?.firstOrNull { it.isDirectory && it.name.startsWith("vosk-model") }

    private fun downloadTo(urlText: String, file: File) {
        val conn = URL(urlText).openConnection() as HttpURLConnection
        conn.connectTimeout = 15000
        conn.readTimeout = 60000
        conn.inputStream.use { inp -> file.outputStream().use { inp.copyTo(it) } }
        conn.disconnect()
    }

    private fun unzip(zip: File, dest: File) {
        val destPath = dest.canonicalPath
        ZipInputStream(zip.inputStream()).use { zis ->
            var entry = zis.nextEntry
            while (entry != null) {
                val out = File(dest, entry.name)
                // Safety: refuse files that try to land outside the model folder
                if (!out.canonicalPath.startsWith(destPath)) throw SecurityException("bad zip entry")
                if (entry.isDirectory) {
                    out.mkdirs()
                } else {
                    out.parentFile?.mkdirs()
                    out.outputStream().use { zis.copyTo(it) }
                }
                zis.closeEntry()
                entry = zis.nextEntry
            }
        }
    }

    private fun startVosk(m: Model) {
        try {
            if (speech == null) {
                val rec = Recognizer(m, 16000f, GRAMMAR)
                speech = SpeechService(rec, 16000f)
            }
            speech?.startListening(voskListener)
        } catch (e: Exception) {
            // Already listening, or the microphone is busy: try again shortly
            main.postDelayed({ startDetection() }, 1500)
        }
    }

    private fun shutdownVosk() {
        try { speech?.shutdown() } catch (e: Exception) { /* ignore */ }
        speech = null
        try { model?.close() } catch (e: Exception) { /* ignore */ }
        model = null
    }

    private val voskListener = object : RecognitionListener {
        override fun onPartialResult(hypothesis: String?) { checkWake(hypothesis) }
        override fun onResult(hypothesis: String?) { checkWake(hypothesis) }
        override fun onFinalResult(hypothesis: String?) { checkWake(hypothesis) }
        override fun onError(exception: Exception?) {
            main.post {
                try { speech?.stop() } catch (e: Exception) { /* ignore */ }
                main.postDelayed({ startDetection() }, 1000)
            }
        }
        override fun onTimeout() {}
    }

    private fun checkWake(json: String?) {
        if (json.isNullOrBlank()) return
        val text = try {
            val o = JSONObject(json)
            o.optString("text").ifBlank { o.optString("partial") }
        } catch (e: Exception) {
            ""
        }
        if (text.isNotBlank() && WAKE.containsMatchIn(text)) {
            main.post { onWakeDetected(text) }
        }
    }

    private fun onWakeDetected(text: String) {
        if (appVisible) return
        try { speech?.stop() } catch (e: Exception) { /* ignore */ }
        openApp(text)
    }

    // ---------- Engine 2: normal speech recognition (fallback) ----------

    private fun listenOnce() {
        if (!running) return
        if (appVisible) {
            main.postDelayed({ startDetection() }, 1000)
            return
        }
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            running = false
            stopSelf()
            return
        }
        release()
        val r = SpeechRecognizer.createSpeechRecognizer(this)
        recognizer = r
        r.setRecognitionListener(object : AndroidRecognitionListener {
            override fun onResults(results: Bundle?) {
                val text = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull() ?: ""
                release()
                if (WAKE.containsMatchIn(text)) openApp(text) else again()
            }
            override fun onError(error: Int) { release(); again() }
            override fun onReadyForSpeech(params: Bundle?) {}
            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(rmsdB: Float) {}
            override fun onBufferReceived(buffer: ByteArray?) {}
            override fun onEndOfSpeech() {}
            override fun onPartialResults(partialResults: Bundle?) {}
            override fun onEvent(eventType: Int, params: Bundle?) {}
        })
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, "hi-IN")
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
        }
        r.startListening(intent)
    }

    private fun again() {
        main.postDelayed({ startDetection() }, 800)
    }

    // ---------- Opening SONIC after the wake word ----------

    // Opens SONIC. A full-screen notification is used because Android blocks plain background launches.
    // On the lock screen, SONIC appears, but the user must still unlock with PIN, pattern or fingerprint.
    private fun openApp(text: String) {
        val i = Intent(this, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            .putExtra(EXTRA_WAKE_TEXT, text)
        val pi = PendingIntent.getActivity(this, 1, i, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val n = NotificationCompat.Builder(this, ALERT_CHANNEL)
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentTitle("Hey SONIC")
            .setContentText("Boliye, main sun raha hoon")
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(pi)
            .setFullScreenIntent(pi, true)
            .build()
        getSystemService(NotificationManager::class.java).notify(ALERT_ID, n)
        try { startActivity(i) } catch (e: Exception) { /* blocked by Android; the notification opens it */ }
        again()
    }

    private fun release() {
        try { recognizer?.destroy() } catch (e: Exception) { /* ignore */ }
        recognizer = null
    }

    companion object {
        const val ACTION_STOP = "com.sonic.app.STOP_VOICE"
        const val EXTRA_WAKE_TEXT = "wake_text"
        const val CHANNEL_ID = "sonic_voice"
        const val ALERT_CHANNEL = "sonic_wake"
        const val NOTIF_ID = 41
        const val ALERT_ID = 42

        // Small English (India) model, about 40 MB, downloaded once. Check the exact file name on alphacephei.com/vosk/models
        const val MODEL_URL = "https://alphacephei.com/vosk/models/vosk-model-small-en-in-0.4.zip"

        // Only these words are listened for, which makes "Hey SONIC" more accurate
        const val GRAMMAR = "[\"hey sonic\", \"sonic\", \"jarvis\", \"[unk]\"]"

        // True while the SONIC screen is open (MainActivity sets it)
        @Volatile var appVisible = false
        // The running service (null when it is off)
        @Volatile var instance: VoiceService? = null

        // Hey SONIC / Hey Jarvis, in English or Hindi spelling (fallback engine)
        private val WAKE = Regex("(sonic|sony|sonik|jarvis|सोनिक|सोनी|जार्विस)", RegexOption.IGNORE_CASE)

        fun start(ctx: Context) {
            val i = Intent(ctx, VoiceService::class.java)
            if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i) else ctx.startService(i)
        }

        fun stop(ctx: Context) {
            ctx.startService(Intent(ctx, VoiceService::class.java).setAction(ACTION_STOP))
        }
    }
}
