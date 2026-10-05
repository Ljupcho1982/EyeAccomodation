package mk.navigator

import android.opengl.GLES11Ext
import android.opengl.GLES20
import android.opengl.GLSurfaceView
import com.google.ar.core.Plane
import com.google.ar.core.Session
import com.google.ar.core.TrackingState
import javax.microedition.khronos.egl.EGLConfig
import javax.microedition.khronos.opengles.GL10

/**
 * Drives ARCore and hands one JSON frame to the web UI about 10 times a second:
 * { tracking, x, z, fx, fz, floorY, points: [x, y, z, ...] } in ARCore world metres.
 *
 * Nothing is drawn: the camera image is never shown. ARCore still needs a GL texture,
 * so a 1-pixel GLSurfaceView provides one.
 */
class ArFrames(
    private val sessionProvider: () -> Session?,
    private val rotationProvider: () -> Int,
    private val send: (String) -> Unit,
) : GLSurfaceView.Renderer {

    private var textureId = 0
    private var width = 1
    private var height = 1
    private var lastSent = 0L
    private var lastFloorAt = 0L
    private var floorY: Float? = null

    override fun onSurfaceCreated(gl: GL10?, config: EGLConfig?) {
        val t = IntArray(1)
        GLES20.glGenTextures(1, t, 0)
        textureId = t[0]
        GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, textureId)
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR)
        sessionProvider()?.setCameraTextureName(textureId)
    }

    override fun onSurfaceChanged(gl: GL10?, w: Int, h: Int) {
        width = w
        height = h
    }

    override fun onDrawFrame(gl: GL10?) {
        val session = sessionProvider() ?: return
        session.setCameraTextureName(textureId)
        session.setDisplayGeometry(rotationProvider(), width, height)
        val frame = try {
            session.update()
        } catch (e: Exception) {
            return
        }
        val now = System.currentTimeMillis()
        if (now - lastSent < 100) return
        lastSent = now

        val camera = frame.camera
        val tracking = when (camera.trackingState) {
            TrackingState.TRACKING -> "TRACKING"
            TrackingState.PAUSED -> "PAUSED"
            else -> "STOPPED"
        }
        val pose = camera.pose
        val fwd = pose.rotateVector(floatArrayOf(0f, 0f, -1f)) // camera looks along -Z

        if (tracking == "TRACKING" && now - lastFloorAt > 500) {
            lastFloorAt = now
            // The floor is the lowest upward-facing horizontal plane ARCore has found.
            floorY = session.getAllTrackables(Plane::class.java)
                .filter { it.trackingState == TrackingState.TRACKING && it.subsumedBy == null && it.type == Plane.Type.HORIZONTAL_UPWARD_FACING }
                .minOfOrNull { it.centerPose.ty() }
        }

        val sb = StringBuilder(4096)
        sb.append("{\"tracking\":\"").append(tracking).append("\",")
            .append("\"x\":").append(pose.tx()).append(",\"z\":").append(pose.tz()).append(',')
            .append("\"fx\":").append(fwd[0]).append(",\"fz\":").append(fwd[2]).append(',')
            .append("\"floorY\":").append(floorY ?: "null").append(",\"points\":[")
        if (tracking == "TRACKING") {
            val pc = frame.acquirePointCloud()
            try {
                val buf = pc.points // x, y, z, confidence per point
                val start = buf.position()
                val n = minOf(buf.remaining() / 4, 400)
                var first = true
                for (i in 0 until n) {
                    val o = start + i * 4
                    if (buf.get(o + 3) < 0.3f) continue
                    if (!first) sb.append(',')
                    first = false
                    sb.append(buf.get(o)).append(',').append(buf.get(o + 1)).append(',').append(buf.get(o + 2))
                }
            } finally {
                pc.release()
            }
        }
        sb.append("]}")
        send(sb.toString())
    }
}

