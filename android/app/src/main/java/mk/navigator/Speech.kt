package mk.navigator

import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import java.util.Locale

/** Spoken output. Macedonian TTS is not on every phone, so fall back to a close voice and say so. */
class Speaker(context: Context, private val onNote: (String) -> Unit) : TextToSpeech.OnInitListener {
    private val tts = TextToSpeech(context, this)
    private var ready = false
    private var lang = ""

    override fun onInit(status: Int) {
        ready = status == TextToSpeech.SUCCESS
    }

    fun say(text: String, langTag: String) {
        if (!ready) return
        if (langTag != lang) {
            lang = langTag
            val locale = Locale.forLanguageTag(langTag)
            if (tts.setLanguage(locale) < TextToSpeech.LANG_AVAILABLE) {
                // Serbian Cyrillic is the closest widely installed voice for Macedonian.
                val fallback = tts.setLanguage(Locale.forLanguageTag("sr-RS"))
                onNote(if (fallback >= TextToSpeech.LANG_AVAILABLE) "tts_fallback" else "tts_missing")
            }
        }
        tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "nav")
    }

    fun stop() {
        tts.stop()
    }

    fun shutdown() {
        tts.shutdown()
    }
}

/**
 * Voice commands. On Android 13+ this uses the strictly on-device recognizer when an offline
 * language pack is installed. Otherwise it asks for offline mode, which the system may ignore:
 * the caller is told so the app can warn that audio may leave the phone.
 */
class Listener(
    private val context: Context,
    private val onText: (String) -> Unit,
    private val onNote: (String) -> Unit,
) {
    private var recognizer: SpeechRecognizer? = null

    fun listen(langTag: String) {
        stop()
        val onDevice = Build.VERSION.SDK_INT >= 33 && SpeechRecognizer.isOnDeviceRecognitionAvailable(context)
        val r = when {
            onDevice -> SpeechRecognizer.createOnDeviceSpeechRecognizer(context)
            SpeechRecognizer.isRecognitionAvailable(context) -> {
                onNote("stt_maybe_online")
                SpeechRecognizer.createSpeechRecognizer(context)
            }
            else -> {
                onNote("stt_missing")
                return
            }
        }
        r.setRecognitionListener(object : RecognitionListener {
            override fun onResults(results: Bundle) {
                results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.let(onText)
            }

            override fun onError(error: Int) = onNote("stt_error_$error")
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
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, langTag)
            putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
        }
        recognizer = r
        r.startListening(intent)
    }

    fun stop() {
        recognizer?.destroy()
        recognizer = null
    }
}
