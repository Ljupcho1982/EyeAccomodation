package mk.navigator

import android.opengl.GLES11Ext
import android.opengl.GLES20
import android.opengl.GLSurfaceView
import com.google.ar.core.AugmentedImage
import com.google.ar.core.Camera
import com.google.ar.core.Frame
import com.google.ar.core.Plane
import com.google.ar.core.Session
import com.google.ar.core.TrackingState
import com.google.ar.core.exceptions.NotYetAvailableException
import java.nio.ByteOrder
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
    private val depthSupported: () -> Boolean,
    private val send: (String) -> Unit,
) : GLSurfaceView.Renderer {

    private companion object {
        const val MIN_DEPTH_MM = 300 // closer than this is noise
        const val MAX_DEPTH_MM = 4000 // farther than this is too noisy to trust
    }

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

        val marker = findMarker(session)

        val sb = StringBuilder(4096)
        sb.append("{\"tracking\":\"").append(tracking).append("\",")
            .append("\"x\":").append(pose.tx()).append(",\"z\":").append(pose.tz()).append(',')
            .append("\"fx\":").append(fwd[0]).append(",\"fz\":").append(fwd[2]).append(',')
            .append("\"floorY\":").append(floorY ?: "null").append(",\"marker\":").append(marker ?: "null")
            .append(",\"points\":[")
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
        sb.append("]")
        if (depthSupported()) {
            sb.append(",\"depth\":[")
            if (tracking == "TRACKING") appendDepthPoints(sb, frame, camera)
            sb.append(']')
        }
        sb.append('}')
        send(sb.toString())
    }

    /**
     * Dense depth from the Depth API as world-space points. Samples a coarse grid of the
     * depth image (about 20 x 11 points) and unprojects each with the camera intrinsics.
     * The image is in sensor orientation, like camera.pose, so no display rotation is applied.
     */
    private fun appendDepthPoints(sb: StringBuilder, frame: Frame, camera: Camera) {
        val image = try {
            frame.acquireDepthImage16Bits()
        } catch (e: NotYetAvailableException) {
            return
        }
        try {
            val w = image.width
            val h = image.height
            val plane = image.planes[0]
            val buf = plane.buffer.order(ByteOrder.LITTLE_ENDIAN).asShortBuffer()
            val rowShorts = plane.rowStride / 2
            val intr = camera.imageIntrinsics
            val sx = w.toFloat() / intr.imageDimensions[0]
            val sy = h.toFloat() / intr.imageDimensions[1]
            val fx = intr.focalLength[0] * sx
            val fy = intr.focalLength[1] * sy
            val cx = intr.principalPoint[0] * sx
            val cy = intr.principalPoint[1] * sy
            val pose = camera.pose
            val step = 8
            var first = true
            var v = step / 2
            while (v < h) {
                var u = step / 2
                while (u < w) {
                    val mm = buf.get(v * rowShorts + u).toInt() and 0x1FFF
                    if (mm in MIN_DEPTH_MM..MAX_DEPTH_MM) {
                        val z = mm / 1000f
                        // image: u right, v down. camera pose: +X right, +Y up, -Z forward.
                        val world = pose.transformPoint(floatArrayOf((u - cx) / fx * z, -(v - cy) / fy * z, -z))
                        if (!first) sb.append(',')
                        first = false
                        sb.append(world[0]).append(',').append(world[1]).append(',').append(world[2])
                    }
                    u += step
                }
                v += step
            }
        } finally {
            image.close()
        }
    }

    /**
     * The wall marker, when ARCore is fully tracking it: its centre and horizontal outward
     * normal in ARCore world metres. Markers lying flat (floor, table) are ignored.
     */
    private fun findMarker(session: Session): String? {
        val img = session.getAllTrackables(AugmentedImage::class.java).firstOrNull {
            it.trackingState == TrackingState.TRACKING && it.trackingMethod == AugmentedImage.TrackingMethod.FULL_TRACKING
        } ?: return null
        val pose = img.centerPose
        val n = pose.rotateVector(floatArrayOf(0f, 1f, 0f)) // the image's Y axis is its normal
        if (Math.abs(n[1]) > 0.5f) return null
        return "{\"x\":${pose.tx()},\"z\":${pose.tz()},\"nx\":${n[0]},\"nz\":${n[2]}}"
    }
}

