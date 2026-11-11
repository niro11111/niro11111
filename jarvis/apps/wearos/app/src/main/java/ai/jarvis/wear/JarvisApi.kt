package ai.jarvis.wear

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.time.Instant
import java.util.UUID

/** Watch-scoped JARVIS client with an idempotent offline queue (SharedPreferences). */
class JarvisApi(val context: Context) {
    private val ctx = context
    private val prefs = ctx.getSharedPreferences("jarvis", Context.MODE_PRIVATE)
    var baseUrl: String get() = prefs.getString("url", "http://192.168.1.10:7777")!! ; set(v) = prefs.edit().putString("url", v).apply()
    var token: String get() = prefs.getString("token", "")!! ; set(v) = prefs.edit().putString("token", v).apply()

    private suspend fun call(path: String, method: String = "GET", body: JSONObject? = null): JSONObject = withContext(Dispatchers.IO) {
        val c = URL(baseUrl.trimEnd('/') + path).openConnection() as HttpURLConnection
        c.requestMethod = method; c.connectTimeout = 10_000; c.readTimeout = 15_000
        c.setRequestProperty("Authorization", "Bearer $token"); c.setRequestProperty("Content-Type", "application/json")
        if (body != null) { c.doOutput = true; c.outputStream.use { it.write(body.toString().toByteArray()) } }
        val code = c.responseCode
        val text = (if (code in 200..299) c.inputStream else c.errorStream)?.bufferedReader()?.readText() ?: "{}"
        if (code !in 200..299) throw RuntimeException("HTTP $code: $text")
        if (text.trim().startsWith("[")) JSONObject().put("items", JSONArray(text)) else JSONObject(text)
    }

    suspend fun glance() = call("/api/watch/glance?lang=he")
    suspend fun action(action: String, text: String = "", extra: Map<String, Any> = emptyMap()): JSONObject {
        val b = JSONObject().put("action", action).put("text", text).put("opId", UUID.randomUUID().toString()).put("clientTime", Instant.now().toString())
        extra.forEach { (k, v) -> b.put(k, v) }
        return call("/api/watch/action", "POST", b)
    }
    suspend fun decide(id: String, approve: Boolean) = call("/api/approvals/$id", "POST", JSONObject().put("decision", if (approve) "approve" else "reject"))
    suspend fun uploadHealth(days: JSONArray) = call("/api/wellness/ingest", "POST", JSONObject().put("days", days))

    fun enqueue(type: String, payload: JSONObject) {
        val q = JSONArray(prefs.getString("queue", "[]"))
        q.put(JSONObject().put("opId", UUID.randomUUID().toString()).put("type", type).put("payload", payload).put("clientTime", Instant.now().toString()))
        prefs.edit().putString("queue", q.toString()).apply()
    }
    suspend fun flush() {
        val q = JSONArray(prefs.getString("queue", "[]"))
        if (q.length() == 0) return
        try { call("/api/sync/push", "POST", JSONObject().put("ops", q)); prefs.edit().putString("queue", "[]").apply() } catch (_: Exception) { /* retry later */ }
    }
}
