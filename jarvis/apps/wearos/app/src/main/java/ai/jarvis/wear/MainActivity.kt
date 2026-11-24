package ai.jarvis.wear

import android.app.RemoteInput
import android.content.Intent
import android.os.Bundle
import android.speech.RecognizerIntent
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.items
import androidx.wear.compose.material.*
import kotlinx.coroutines.launch
import org.json.JSONObject

private val Cyan = Color(0xFF2EE6FF)
private val Amber = Color(0xFFFFBF3C)

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val api = JarvisApi(this)
        setContent { MaterialTheme { JarvisWatch(api) } }
    }
}

@Composable
fun JarvisWatch(api: JarvisApi) {
    val scope = rememberCoroutineScope()
    var glance by remember { mutableStateOf<JSONObject?>(null) }
    var answer by remember { mutableStateOf("") }
    var error by remember { mutableStateOf("") }
    fun refresh() = scope.launch { try { glance = api.glance(); error = ""; api.flush() } catch (e: Exception) { error = e.message ?: "error" } }
    LaunchedEffect(Unit) { refresh() }

    // Voice input through the platform speech recognizer (only while the user taps).
    val speech = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        val text = r.data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull() ?: return@rememberLauncherForActivityResult
        scope.launch {
            answer = try { api.action("ask", text).optString("response", "—") } catch (e: Exception) { api.enqueue("command", JSONObject().put("text", text)); "אין חיבור. נשמר ויישלח אחר כך." }
        }
    }
    val approvals = glance?.optJSONArray("approvals")
    val tasks = glance?.optJSONArray("tasks")

    Scaffold(timeText = { TimeText() }) {
        ScalingLazyColumn(modifier = Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally) {
            item { CoreRing(if ((approvals?.length() ?: 0) > 0) Amber else Cyan) }
            item {
                Chip(onClick = {
                    speech.launch(Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM).putExtra(RecognizerIntent.EXTRA_LANGUAGE, "he-IL"))
                }, label = { Text("דבר עם ג׳ארוויס") }, colors = ChipDefaults.primaryChipColors(backgroundColor = Cyan.copy(alpha = .25f)))
            }
            if (answer.isNotEmpty()) item { Text(answer, fontSize = 12.sp, textAlign = TextAlign.Center) }
            if (approvals != null) items((0 until approvals.length()).toList()) { i ->
                val a = approvals.getJSONObject(i)
                Card(onClick = {}) {
                    Text(a.getString("summary"), fontSize = 12.sp)
                    Row { 
                        CompactChip(onClick = { scope.launch { answer = api.decide(a.getString("id"), true).optString("response"); refresh() } }, label = { Text("אשר") })
                        Spacer(Modifier.width(6.dp))
                        CompactChip(onClick = { scope.launch { api.decide(a.getString("id"), false); refresh() } }, label = { Text("דחה") })
                    }
                }
            }
            if (tasks != null) items((0 until tasks.length()).toList()) { i ->
                val t = tasks.getJSONObject(i)
                ToggleChip(checked = false, onCheckedChange = { scope.launch { api.action("complete_task", extra = mapOf("id" to t.getString("id"))); refresh() } },
                    label = { Text(t.getString("title"), maxLines = 2) }, toggleControl = { Icon(imageVector = ToggleChipDefaults.checkboxIcon(false), contentDescription = null) })
            }
            item { Chip(onClick = { scope.launch { answer = api.action("timer", extra = mapOf("minutes" to 5)).optString("status") } }, label = { Text("טיימר 5 דק׳") }) }
            item { Chip(onClick = { scope.launch { answer = api.action("find_phone").optString("status") } }, label = { Text("מצא את הטלפון") }) }
            item { Chip(onClick = { scope.launch { answer = HealthSync.uploadToday(api) } }, label = { Text("סנכרון בריאות") }) }
            if (error.isNotEmpty()) item { Text(error, color = Color.Red, fontSize = 10.sp) }
        }
    }
}

@Composable
fun CoreRing(color: Color) {
    Box(Modifier.size(80.dp), contentAlignment = Alignment.Center) {
        Canvas(Modifier.fillMaxSize()) {
            drawCircle(color.copy(alpha = .25f), style = Stroke(3f))
            drawArc(color, 0f, 110f, false, style = Stroke(6f))
            drawCircle(Brush.radialGradient(listOf(Color.White, color.copy(alpha = .5f), Color.Transparent)), radius = size.minDimension / 3)
        }
        Text("JARVIS", fontSize = 9.sp, letterSpacing = 2.sp)
    }
}
