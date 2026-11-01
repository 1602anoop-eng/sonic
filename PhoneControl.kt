package com.sonic.app

import android.content.Context
import android.content.Intent
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.media.AudioManager
import android.net.Uri
import android.os.BatteryManager
import android.provider.AlarmClock
import android.provider.MediaStore
import android.provider.Settings
import org.json.JSONObject

// Phone actions that a normal Android app is allowed to do.
// Every action returns {"ok": true/false, "message": "..."}.
// Nothing here sends messages, makes calls, or changes security settings on its own.
object PhoneControl {

    fun run(ctx: Context, req: JSONObject): JSONObject = try {
        when (req.optString("action")) {
            "flashlight" -> flashlight(ctx, req.optBoolean("on", true))
            "volume" -> volume(ctx, req.optInt("level", 50))
            "alarm" -> alarm(ctx, req.optInt("hour", -1), req.optInt("minute", 0), req.optString("label", "SONIC"))
            "timer" -> timer(ctx, req.optInt("seconds", 0), req.optString("label", "SONIC"))
            "openApp" -> openApp(ctx, req.optString("pkg"))
            "openSettings" -> openSettings(ctx, req.optString("page", "main"))
            "map" -> map(ctx, req.optString("query"))
            "camera" -> launch(ctx, Intent(MediaStore.ACTION_IMAGE_CAPTURE), "Camera khol raha hoon")
            "dial" -> dial(ctx, req.optString("number"))
            "battery" -> battery(ctx)
            else -> fail("Ye action supported nahi hai")
        }
    } catch (e: Exception) {
        fail("Action fail: ${e.javaClass.simpleName}")
    }

    private fun flashlight(ctx: Context, on: Boolean): JSONObject {
        val cm = ctx.getSystemService(Context.CAMERA_SERVICE) as CameraManager
        val id = cm.cameraIdList.firstOrNull {
            cm.getCameraCharacteristics(it).get(CameraCharacteristics.FLASH_INFO_AVAILABLE) == true
        } ?: return fail("Is phone mein flashlight nahi hai")
        cm.setTorchMode(id, on)
        return ok(if (on) "Flashlight on" else "Flashlight off")
    }

    private fun volume(ctx: Context, level: Int): JSONObject {
        val am = ctx.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        val pct = level.coerceIn(0, 100)
        val max = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
        am.setStreamVolume(AudioManager.STREAM_MUSIC, pct * max / 100, AudioManager.FLAG_SHOW_UI)
        return ok("Volume $pct% par set")
    }

    private fun alarm(ctx: Context, hour: Int, minute: Int, label: String): JSONObject {
        if (hour !in 0..23 || minute !in 0..59) return fail("Alarm ka time galat hai")
        val i = Intent(AlarmClock.ACTION_SET_ALARM)
            .putExtra(AlarmClock.EXTRA_HOUR, hour)
            .putExtra(AlarmClock.EXTRA_MINUTES, minute)
            .putExtra(AlarmClock.EXTRA_MESSAGE, label)
            .putExtra(AlarmClock.EXTRA_SKIP_UI, true)
        return launch(ctx, i, "Alarm set: %02d:%02d".format(hour, minute))
    }

    private fun timer(ctx: Context, seconds: Int, label: String): JSONObject {
        if (seconds <= 0) return fail("Timer ka time galat hai")
        val i = Intent(AlarmClock.ACTION_SET_TIMER)
            .putExtra(AlarmClock.EXTRA_LENGTH, seconds)
            .putExtra(AlarmClock.EXTRA_MESSAGE, label)
            .putExtra(AlarmClock.EXTRA_SKIP_UI, true)
        return launch(ctx, i, "Timer set: $seconds second")
    }

    private fun openApp(ctx: Context, pkg: String): JSONObject {
        if (pkg.isBlank()) return fail("App ka package naam nahi diya")
        val i = ctx.packageManager.getLaunchIntentForPackage(pkg)
            ?: return fail("App nahi mili ya install nahi hai: $pkg")
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        ctx.startActivity(i)
        return ok("App khol raha hoon: $pkg")
    }

    private fun openSettings(ctx: Context, page: String): JSONObject {
        val action = when (page) {
            "wifi" -> Settings.ACTION_WIFI_SETTINGS
            "bluetooth" -> Settings.ACTION_BLUETOOTH_SETTINGS
            "display" -> Settings.ACTION_DISPLAY_SETTINGS
            "sound" -> Settings.ACTION_SOUND_SETTINGS
            "battery" -> Intent.ACTION_POWER_USAGE_SUMMARY
            "apps" -> Settings.ACTION_APPLICATION_SETTINGS
            else -> Settings.ACTION_SETTINGS
        }
        return launch(ctx, Intent(action), "Settings khol raha hoon: $page")
    }

    private fun map(ctx: Context, query: String): JSONObject {
        if (query.isBlank()) return fail("Map ke liye jagah ka naam do")
        val i = Intent(Intent.ACTION_VIEW, Uri.parse("geo:0,0?q=" + Uri.encode(query)))
        return launch(ctx, i, "Maps mein dhoondh raha hoon: $query")
    }

    // Opens the dialer with the number filled in. The user presses call themselves.
    private fun dial(ctx: Context, number: String): JSONObject {
        if (number.isBlank()) return fail("Number nahi diya")
        val i = Intent(Intent.ACTION_DIAL, Uri.parse("tel:" + Uri.encode(number)))
        return launch(ctx, i, "Dialer mein number daal diya: $number")
    }

    private fun battery(ctx: Context): JSONObject {
        val bm = ctx.getSystemService(Context.BATTERY_SERVICE) as BatteryManager
        val pct = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
        return ok("Battery $pct%").put("percent", pct)
    }

    private fun launch(ctx: Context, i: Intent, okMsg: String): JSONObject {
        if (i.resolveActivity(ctx.packageManager) == null) {
            return fail("Is phone mein ye feature available nahi hai")
        }
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        ctx.startActivity(i)
        return ok(okMsg)
    }

    private fun ok(msg: String): JSONObject = JSONObject().put("ok", true).put("message", msg)
    private fun fail(msg: String): JSONObject = JSONObject().put("ok", false).put("message", msg)
}
