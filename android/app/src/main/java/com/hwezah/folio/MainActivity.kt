package com.hwezah.folio

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.ContentValues
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.MediaStore
import android.provider.OpenableColumns
import android.util.Base64
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.FileProvider
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import android.widget.FrameLayout
import androidx.webkit.WebViewAssetLoader
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * Folio on Android: the web app, bundled in assets/www and served offline by WebViewAssetLoader,
 * plus what a browser tab can't do — "Open with", "Share to Folio", saving to Downloads,
 * the system share sheet and the camera for Scan to PDF.
 */
class MainActivity : AppCompatActivity() {
    private lateinit var web: WebView
    private lateinit var root: FrameLayout
    private lateinit var updater: Updater
    private val origin = "https://appassets.androidplatform.net"
    private var filePathCallback: ValueCallback<Array<Uri>>? = null
    private var cameraUri: Uri? = null
    private var pageReady = false
    /** Files (or text) handed to us before the page was ready to take them. */
    private val pending = mutableListOf<String>()

    private val pickFiles = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        val data = r.data
        val uris = when {
            r.resultCode != RESULT_OK -> null
            data?.clipData != null -> Array(data.clipData!!.itemCount) { data.clipData!!.getItemAt(it).uri }
            data?.data != null -> arrayOf(data.data!!)
            else -> null
        }
        filePathCallback?.onReceiveValue(uris)
        filePathCallback = null
    }

    private val takePhoto = registerForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        filePathCallback?.onReceiveValue(if (ok && cameraUri != null) arrayOf(cameraUri!!) else null)
        filePathCallback = null
    }

    private val cameraPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) launchCamera() else {
            filePathCallback?.onReceiveValue(null)
            filePathCallback = null
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        updater = Updater(this) { state -> deliver("window.folioUpdate && window.folioUpdate($state)") }
        // Draw edge to edge, then keep the page clear of the status bar, notch, navigation bar and keyboard.
        WindowCompat.setDecorFitsSystemWindows(window, false)
        val loader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        web = WebView(this).apply {
            setBackgroundColor(0xFF0A0A0A.toInt())
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.databaseEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = true
            settings.mediaPlaybackRequiresUserGesture = true
            settings.textZoom = 100
            addJavascriptInterface(Bridge(), "FolioAndroid")
            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                    loader.shouldInterceptRequest(request.url)

                // Links in documents open in the browser, not inside Folio.
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    if (request.url.toString().startsWith(origin)) return false
                    try {
                        startActivity(Intent(Intent.ACTION_VIEW, request.url))
                    } catch (_: ActivityNotFoundException) {
                    }
                    return true
                }
            }
            webChromeClient = object : WebChromeClient() {
                override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                    filePathCallback?.onReceiveValue(null)
                    filePathCallback = callback
                    if (params.isCaptureEnabled) {
                        if (checkSelfPermission(android.Manifest.permission.CAMERA) == android.content.pm.PackageManager.PERMISSION_GRANTED) launchCamera()
                        else cameraPermission.launch(android.Manifest.permission.CAMERA)
                        return true
                    }
                    val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                        addCategory(Intent.CATEGORY_OPENABLE)
                        type = "*/*"
                        val accept = params.acceptTypes.flatMap { it.split(",") }.map { it.trim() }.filter { it.contains("/") }
                        if (accept.isNotEmpty() && accept.none { it == "*/*" }) putExtra(Intent.EXTRA_MIME_TYPES, accept.toTypedArray())
                        putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.mode == FileChooserParams.MODE_OPEN_MULTIPLE)
                    }
                    return try {
                        pickFiles.launch(intent)
                        true
                    } catch (_: ActivityNotFoundException) {
                        filePathCallback = null
                        false
                    }
                }
            }
        }
        root = FrameLayout(this).apply {
            setBackgroundColor(0xFF0A0A0A.toInt())
            addView(web, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        }
        ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            v.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, ime.bottom))
            WindowInsetsCompat.CONSUMED
        }
        setContentView(root)
        setDark(true)

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (web.canGoBack()) web.goBack() else finish()
            }
        })

        if (savedInstanceState != null) web.restoreState(savedInstanceState)
        else web.loadUrl("$origin/assets/www/index.html")
        handleIntent(intent)
    }

    /** While Folio is open it keeps looking for a new build, every few minutes. */
    private val ticker = android.os.Handler(android.os.Looper.getMainLooper())
    private val tick = object : Runnable {
        override fun run() {
            updater.check()
            ticker.postDelayed(this, 5 * 60_000L)
        }
    }

    override fun onResume() {
        super.onResume()
        updater.resume()
        ticker.removeCallbacks(tick)
        ticker.post(tick)
    }

    override fun onPause() {
        super.onPause()
        ticker.removeCallbacks(tick)
    }

    /** Status and navigation bars in the page's colour, with icons that read on it. */
    private fun setDark(dark: Boolean) {
        val color = if (dark) 0xFF0A0A0A.toInt() else 0xFFF6F2EE.toInt()
        root.setBackgroundColor(color)
        web.setBackgroundColor(color)
        WindowCompat.getInsetsController(window, root).apply {
            isAppearanceLightStatusBars = !dark
            isAppearanceLightNavigationBars = !dark
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIntent(intent)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    private fun launchCamera() {
        val dir = File(cacheDir, "camera").apply { mkdirs() }
        val file = File(dir, "page-${System.currentTimeMillis()}.jpg")
        cameraUri = FileProvider.getUriForFile(this, "$packageName.files", file)
        takePhoto.launch(cameraUri!!)
    }

    /** "Open with" and "Share to": read each file and pass it to the page as base64. */
    private fun handleIntent(intent: Intent?) {
        intent ?: return
        val uris = mutableListOf<Uri>()
        when (intent.action) {
            Intent.ACTION_VIEW -> intent.data?.let { uris += it }
            Intent.ACTION_SEND -> {
                @Suppress("DEPRECATION")
                (if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java) else intent.getParcelableExtra(Intent.EXTRA_STREAM))?.let { uris += it }
                if (uris.isEmpty()) intent.getStringExtra(Intent.EXTRA_TEXT)?.let { text ->
                    deliver("window.folioReceiveText && window.folioReceiveText(${JSONObject.quote(text)})")
                }
            }
            Intent.ACTION_SEND_MULTIPLE -> {
                @Suppress("DEPRECATION")
                (if (Build.VERSION.SDK_INT >= 33) intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java) else intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM))?.let { uris += it }
            }
        }
        if (uris.isEmpty()) return
        intent.action = null // a rotation shouldn't open the same file twice
        Thread {
            val files = JSONArray()
            for (u in uris) {
                try {
                    val bytes = contentResolver.openInputStream(u)?.use { it.readBytes() } ?: continue
                    files.put(JSONObject().apply {
                        put("name", nameOf(u))
                        put("type", contentResolver.getType(u) ?: "")
                        put("data", Base64.encodeToString(bytes, Base64.NO_WRAP))
                    })
                } catch (e: Exception) {
                    runOnUiThread { Toast.makeText(this, "Couldn't read that file: ${e.message}", Toast.LENGTH_LONG).show() }
                }
            }
            if (files.length() > 0) runOnUiThread { deliver("window.folioReceive && window.folioReceive($files)") }
        }.start()
    }

    private fun deliver(js: String) {
        if (pageReady) web.evaluateJavascript(js, null) else pending += js
    }

    private fun nameOf(u: Uri): String {
        contentResolver.query(u, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
            if (c.moveToFirst()) c.getString(0)?.let { return it }
        }
        return u.lastPathSegment?.substringAfterLast('/') ?: "file"
    }

    /** What the page can ask of Android. */
    inner class Bridge {
        /** The page has loaded its library and can take files. */
        @JavascriptInterface
        fun ready() = runOnUiThread {
            pageReady = true
            updater.state?.let { pending += "window.folioUpdate && window.folioUpdate($it)" }
            pending.forEach { web.evaluateJavascript(it, null) }
            pending.clear()
        }

        @JavascriptInterface
        fun version(): String = "${updater.currentName}"

        @JavascriptInterface
        fun checkForUpdate() = updater.check(manual = true)

        @JavascriptInterface
        fun installUpdate() = runOnUiThread { updater.installReady() }

        @JavascriptInterface
        fun setDark(dark: Boolean) = runOnUiThread { this@MainActivity.setDark(dark) }

        /** Saves to the phone's Downloads folder. */
        @JavascriptInterface
        fun save(name: String, mime: String, base64: String) {
            try {
                val bytes = Base64.decode(base64, Base64.DEFAULT)
                val values = ContentValues().apply {
                    put(MediaStore.Downloads.DISPLAY_NAME, name)
                    put(MediaStore.Downloads.MIME_TYPE, mime.ifEmpty { "application/octet-stream" })
                    put(MediaStore.Downloads.IS_PENDING, 1)
                }
                val uri = contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: error("no Downloads folder")
                contentResolver.openOutputStream(uri)?.use { it.write(bytes) }
                values.clear()
                values.put(MediaStore.Downloads.IS_PENDING, 0)
                contentResolver.update(uri, values, null, null)
                runOnUiThread { Toast.makeText(this@MainActivity, "Saved to Downloads: $name", Toast.LENGTH_SHORT).show() }
            } catch (e: Exception) {
                runOnUiThread { Toast.makeText(this@MainActivity, "Couldn't save: ${e.message}", Toast.LENGTH_LONG).show() }
            }
        }

        /** Opens the share sheet with the file (Drive, mail, WhatsApp…). */
        @JavascriptInterface
        fun share(name: String, mime: String, base64: String) {
            try {
                val dir = File(cacheDir, "shared").apply { mkdirs(); listFiles()?.forEach { it.delete() } }
                val file = File(dir, name.replace(Regex("[\\\\/:*?\"<>|]"), "-"))
                file.writeBytes(Base64.decode(base64, Base64.DEFAULT))
                val uri = FileProvider.getUriForFile(this@MainActivity, "$packageName.files", file)
                val send = Intent(Intent.ACTION_SEND).apply {
                    type = mime.ifEmpty { "application/octet-stream" }
                    putExtra(Intent.EXTRA_STREAM, uri)
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }
                runOnUiThread { startActivity(Intent.createChooser(send, name)) }
            } catch (e: Exception) {
                runOnUiThread { Toast.makeText(this@MainActivity, "Couldn't share: ${e.message}", Toast.LENGTH_LONG).show() }
            }
        }
    }
}
