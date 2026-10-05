package mk.navigator

import android.Manifest
import android.annotation.SuppressLint
import android.content.pm.PackageManager
import android.opengl.GLSurfaceView
import android.os.Bundle
import android.view.Gravity
import android.view.KeyEvent
import android.view.WindowManager
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.webkit.WebViewAssetLoader
import com.google.ar.core.ArCoreApk
import com.google.ar.core.Config
import com.google.ar.core.Session
import com.google.ar.core.exceptions.CameraNotAvailableException
import com.google.ar.core.exceptions.UnavailableException
import org.json.JSONObject

class MainActivity : AppCompatActivity() {
    private lateinit var web: WebView
    private lateinit var glView: GLSurfaceView
    private lateinit var speaker: Speaker
    private lateinit var listener: Listener
    private var session: Session? = null
    private var installRequested = false
    private var pageReady = false

    private val permissions = arrayOf(Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO)

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        speaker = Speaker(this) { note -> note(note) }
        listener = Listener(this, { text -> js("window.__arCommand(${JSONObject.quote(text)})") }, { note -> note(note) })

        web = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.blockNetworkLoads = true // fully offline: fonts fall back to system fonts
        }
        val loader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()
        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                loader.shouldInterceptRequest(request.url)
        }
        web.addJavascriptInterface(
            JsBridge(this, speaker, listener, SecureStore(this)) { pageReady = true },
            "Android",
        )

        glView = GLSurfaceView(this).apply {
            setEGLContextClientVersion(2)
            preserveEGLContextOnPause = true
            setRenderer(ArFrames({ session }, { displayRotation() }) { json -> js("window.__arFrame($json)") })
            renderMode = GLSurfaceView.RENDERMODE_CONTINUOUSLY
        }

        setContentView(FrameLayout(this).apply {
            addView(web, FrameLayout.LayoutParams(-1, -1))
            // ARCore needs a live GL surface; one pixel is enough because nothing is drawn.
            addView(glView, FrameLayout.LayoutParams(1, 1, Gravity.BOTTOM or Gravity.END))
        })
        web.loadUrl("https://appassets.androidplatform.net/assets/index.html")
    }

    private fun js(code: String) {
        runOnUiThread { if (::web.isInitialized) web.evaluateJavascript(code, null) }
    }

    /** Short status notes from native code, shown and spoken by the web UI. */
    private fun note(key: String) = js("window.__arNote && window.__arNote(${JSONObject.quote(key)})")

    @Suppress("DEPRECATION")
    private fun displayRotation(): Int = (getSystemService(WINDOW_SERVICE) as WindowManager).defaultDisplay.rotation

    override fun onResume() {
        super.onResume()
        if (permissions.any { ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED }) {
            ActivityCompat.requestPermissions(this, permissions, 1)
            return
        }
        startSession()
    }

    override fun onRequestPermissionsResult(requestCode: Int, p: Array<out String>, r: IntArray) {
        super.onRequestPermissionsResult(requestCode, p, r)
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            startSession()
        } else {
            note("camera_denied")
        }
    }

    private fun startSession() {
        try {
            if (session == null) {
                when (ArCoreApk.getInstance().requestInstall(this, !installRequested)) {
                    ArCoreApk.InstallStatus.INSTALL_REQUESTED -> {
                        installRequested = true
                        return
                    }
                    ArCoreApk.InstallStatus.INSTALLED -> Unit
                }
                session = Session(this).also { s ->
                    s.configure(Config(s).apply {
                        planeFindingMode = Config.PlaneFindingMode.HORIZONTAL
                        updateMode = Config.UpdateMode.LATEST_CAMERA_IMAGE
                        focusMode = Config.FocusMode.AUTO
                    })
                }
            }
            session?.resume()
            glView.onResume()
        } catch (e: UnavailableException) {
            note("arcore_unavailable")
        } catch (e: CameraNotAvailableException) {
            note("camera_busy")
        } catch (e: SecurityException) {
            note("camera_denied")
        }
    }

    override fun onPause() {
        super.onPause()
        glView.onPause()
        session?.pause()
        speaker.stop()
        listener.stop()
    }

    override fun onDestroy() {
        session?.close()
        session = null
        speaker.shutdown()
        super.onDestroy()
    }

    // Volume-down starts listening: a blind user can find a physical key without seeing the screen.
    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
        if (keyCode == KeyEvent.KEYCODE_VOLUME_DOWN && event.repeatCount == 0) {
            speaker.stop()
            val lang = if (resources.configuration.locales[0].language == "en") "en-US" else "mk-MK"
            listener.listen(lang)
            return true
        }
        return super.onKeyDown(keyCode, event)
    }
}
