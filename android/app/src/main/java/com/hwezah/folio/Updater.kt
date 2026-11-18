package com.hwezah.folio

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import android.widget.Toast
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/**
 * Keeps Folio current without visiting GitHub: every push to main publishes Folio.apk and version.json
 * on the "folio-latest" release. On each open (at most every 15 minutes) this reads version.json; when
 * its build is newer than this one, it downloads the APK in the background and offers to install it.
 */
class Updater(private val activity: Activity, private val onState: (JSONObject) -> Unit) {
    private val base = "https://github.com/Hwezah/Document-Converter/releases/download/folio-latest"
    private val dir = File(activity.cacheDir, "updates").apply { mkdirs() }
    private var lastCheck = 0L
    private var busy = false
    /** An APK downloaded and waiting for the user to allow installs from Folio. */
    private var waiting: File? = null
    /** The newest build downloaded and ready, and what the page was last told. */
    private var ready: File? = null
    var state: JSONObject? = null
        private set

    private fun tell(s: String, name: String = "", summary: String = "") {
        val j = JSONObject().put("state", s).put("name", name).put("summary", summary)
        state = if (s == "none") null else j
        activity.runOnUiThread { onState(j) }
    }

    val currentCode: Long
        get() = activity.packageManager.getPackageInfo(activity.packageName, 0).longVersionCode

    val currentName: String
        get() = activity.packageManager.getPackageInfo(activity.packageName, 0).versionName ?: "?"

    fun check(manual: Boolean = false) {
        val now = System.currentTimeMillis()
        if (busy || (!manual && now - lastCheck < 4 * 60_000)) return
        lastCheck = now
        busy = true
        Thread {
            try {
                val info = JSONObject(get("$base/version.json").decodeToString())
                val code = info.getLong("versionCode")
                if (code <= currentCode) {
                    if (manual) toast("Folio is up to date")
                    if (state != null) tell("none")
                    dir.listFiles()?.forEach { it.delete() }
                    return@Thread
                }
                val apk = File(dir, "Folio-$code.apk")
                val name = info.optString("versionName", "build $code")
                val summary = info.optString("summary")
                if (!apk.exists() || apk.length() != info.optLong("size", -1)) {
                    tell("downloading", name, summary)
                    val tmp = File(dir, "download.tmp")
                    tmp.writeBytes(get("$base/Folio.apk"))
                    tmp.renameTo(apk)
                }
                ready = apk
                tell("ready", name, summary)
            } catch (e: Exception) {
                if (manual) toast("Couldn't check for updates: ${e.message}")
                if (state?.optString("state") == "downloading") tell("none")
            } finally {
                busy = false
            }
        }.start()
    }

    /** After the user comes back from allowing installs, carry on. */
    fun resume() {
        val apk = waiting ?: return
        if (activity.packageManager.canRequestPackageInstalls()) {
            waiting = null
            install(apk)
        }
    }

    /** The strip's Install button. */
    fun installReady() {
        val apk = ready ?: return check(manual = true)
        install(apk)
    }

    private fun install(apk: File) {
        if (!activity.packageManager.canRequestPackageInstalls()) {
            // Android asks once: "Allow installs from Folio".
            waiting = apk
            toast("Allow Folio to install its updates, then come back")
            activity.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${activity.packageName}")))
            return
        }
        val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.files", apk)
        activity.startActivity(Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        })
    }

    private fun get(url: String): ByteArray {
        var u = URL(url)
        repeat(5) {
            val c = u.openConnection() as HttpURLConnection
            c.instanceFollowRedirects = false
            c.connectTimeout = 15_000
            c.readTimeout = 60_000
            c.setRequestProperty("User-Agent", "Folio-Updater")
            when (c.responseCode) {
                in 300..399 -> u = URL(u, c.getHeaderField("Location"))
                200 -> return c.inputStream.use { it.readBytes() }
                else -> error("HTTP ${c.responseCode}")
            }
        }
        error("too many redirects")
    }

    private fun toast(msg: String) = activity.runOnUiThread { Toast.makeText(activity, msg, Toast.LENGTH_SHORT).show() }
}
