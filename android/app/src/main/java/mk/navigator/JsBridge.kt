package mk.navigator

import android.app.Activity
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.webkit.JavascriptInterface
import org.json.JSONArray

/**
 * The `Android` object the web UI sees. Everything here is called from the WebView's
 * JavaScript thread, so anything touching views or the recognizer hops to the main thread.
 */
class JsBridge(
    private val activity: Activity,
    private val speaker: Speaker,
    private val listener: Listener,
    private val store: SecureStore,
    private val onReady: () -> Unit,
) {
    @Suppress("DEPRECATION")
    private val vibrator = activity.getSystemService(Vibrator::class.java)

    @JavascriptInterface
    fun say(text: String, langTag: String) {
        activity.runOnUiThread { speaker.say(text, langTag) }
    }

    /**
     * pattern is [on, off, on, ...] in ms, as in the browser. Short pulses are light (low
     * amplitude), long ones strong. Two light = path is left, one strong = path is right.
     */
    @JavascriptInterface
    fun vibrate(patternJson: String) {
        val p = JSONArray(patternJson)
        if (p.length() == 0 || !vibrator.hasVibrator()) return
        val timings = LongArray(p.length() + 1)
        val amps = IntArray(p.length() + 1)
        for (i in 0 until p.length()) {
            val ms = p.getLong(i)
            timings[i + 1] = ms
            amps[i + 1] = if (i % 2 == 0) (if (ms >= 200) 255 else 90) else 0
        }
        val effect = if (vibrator.hasAmplitudeControl()) {
            VibrationEffect.createWaveform(timings, amps, -1)
        } else {
            VibrationEffect.createWaveform(timings, -1)
        }
        vibrator.vibrate(effect)
    }

    @JavascriptInterface
    fun listen(langTag: String) {
        activity.runOnUiThread {
            speaker.stop()
            listener.listen(langTag)
        }
    }

    @JavascriptInterface
    fun secureSave(json: String) = store.save(json)

    @JavascriptInterface
    fun secureLoad(): String = store.load()

    @JavascriptInterface
    fun ready() = onReady()
}
