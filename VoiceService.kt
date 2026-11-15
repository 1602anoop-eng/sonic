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
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import androidx.core.app.NotificationCompat

// Keeps "Hey SONIC" listening while the app is in the background.
// Android shows a notification while this runs (required for microphone use in the background).
// While the SONIC screen is open, the screen itself listens, so this service pauses.
class VoiceService : Service() {

    private val main = Handler(Looper.getMainLooper())
    private var recognizer: SpeechRecognizer? = null
    private var running = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createChannel()
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
            main.post { listenOnce() }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        running = false
        main.post { release() }
        super.onDestroy()
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

    private fun createChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            val nm = getSystemService(NotificationManager::class.java)
            nm.createNotificationChannel(NotificationChannel(CHANNEL_ID, "SONIC voice", NotificationManager.IMPORTANCE_LOW))
        }
    }

    // One short listening session. The result is checked for the wake word, then listening restarts.
    private fun listenOnce() {
        if (!running) return
        if (appVisible) {
            main.postDelayed({ listenOnce() }, 1000)
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
                if (WAKE.containsMatchIn(text)) wake(text) else again()
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
        main.postDelayed({ listenOnce() }, 800)
    }

    // Brings SONIC to the front with the words spoken after "Hey SONIC".
    // Android may block this from the background. In that case the notification opens the app.
    private fun wake(text: String) {
        val i = Intent(this, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            .putExtra(EXTRA_WAKE_TEXT, text)
        try { startActivity(i) } catch (e: Exception) { /* blocked by Android; notification still works */ }
        again()
    }

    private fun release() {
        recognizer?.destroy()
        recognizer = null
    }

    companion object {
        const val ACTION_STOP = "com.sonic.app.STOP_VOICE"
        const val EXTRA_WAKE_TEXT = "wake_text"
        const val CHANNEL_ID = "sonic_voice"
        const val NOTIF_ID = 41
        // True while the SONIC screen is open (MainActivity sets it)
        @Volatile var appVisible = false
        // Hey SONIC / Hey Jarvis, in English or Hindi spelling
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
