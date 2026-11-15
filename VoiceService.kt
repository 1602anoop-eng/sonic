package com.sonic.app

import ai.picovoice.porcupine.PorcupineManager
import ai.picovoice.porcupine.PorcupineManagerCallback
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
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import androidx.core.app.NotificationCompat
import java.io.File

// Keeps "Hey SONIC" listening while the app is in the background.
// Engine 1 (reliable, offline): Porcupine wake-word engine, used when the Picovoice key and keyword file are set up.
// Engine 2 (fallback): normal speech recognition loop, used when Porcupine is not set up.
// A notification is shown while this runs (Android requires it for microphone use in the background).
class VoiceService : Service() {

    private val main = Handler(Looper.getMainLooper())
    private var recognizer: SpeechRecognizer? = null
    private var porcupine: PorcupineManager? = null
    private var running = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        instance = this
        createChannels()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            running = false
            main.post { release() }
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
        main.post { release() }
        try { porcupine?.delete() } catch (e: Exception) { /* already released */ }
        porcupine = null
        super.onDestroy()
    }

    // Called by MainActivity: while the SONIC screen is open, the screen listens, so the service steps aside
    fun pauseDetection() {
        try { porcupine?.stop() } catch (e: Exception) { /* not running */ }
        main.post { release() }
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
        if (startPorcupine()) return
        listenOnce()
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

    // ---------- Engine 1: Porcupine (reliable offline wake word) ----------

    private fun startPorcupine(): Boolean {
        porcupine?.let {
            return try { it.start(); true } catch (e: Exception) { false }
        }
        val key = BuildConfig.PICOVOICE_KEY
        if (key.isBlank()) return false
        return try {
            val file = File(filesDir, KEYWORD_FILE)
            if (!file.exists()) {
                assets.open(KEYWORD_FILE).use { inp -> file.outputStream().use { inp.copyTo(it) } }
            }
            val pm = PorcupineManager.Builder()
                .setAccessKey(key)
                .setKeywordPath(file.absolutePath)
                .build(applicationContext, PorcupineManagerCallback { _ -> main.post { onWakeDetected() } })
            porcupine = pm
            pm.start()
            true
        } catch (e: Exception) {
            porcupine = null
            false
        }
    }

    private fun onWakeDetected() {
        if (appVisible) return
        openApp("hey sonic")
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
        r.setRecognitionListener(object : RecognitionListener {
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
    // When the phone is locked, Android shows SONIC on the lock screen. The user still needs PIN, pattern or fingerprint to unlock.
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
        const val KEYWORD_FILE = "hey_sonic.ppn"

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
