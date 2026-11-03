package ai.jarvis.wear

import androidx.health.services.client.HealthServices
import androidx.health.services.client.data.DataType
import androidx.health.services.client.data.PassiveListenerConfig
import kotlinx.coroutines.guava.await
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate

/**
 * Optional Wear OS Health Services upload. Reads today's daily step total through the passive
 * monitoring client. The server rejects uploads unless Health is enabled in the Privacy Center,
 * and JARVIS only summarises trends - it never diagnoses.
 */
object HealthSync {
    suspend fun uploadToday(api: JarvisApi): String {
        val client = HealthServices.getClient(api.context).passiveMonitoringClient
        val caps = runCatching { client.getCapabilitiesAsync().await() }.getOrNull() ?: return "Health Services לא זמין"
        if (DataType.STEPS_DAILY !in caps.supportedDataTypesPassiveMonitoring) return "צעדים לא נתמכים במכשיר"
        // A full implementation registers a PassiveListenerService with this config and stores
        // the daily totals it receives; here we upload what the service last saved.
        PassiveListenerConfig.builder().setDataTypes(setOf(DataType.STEPS_DAILY)).build()
        val steps = StepStore.today ?: return "אין עדיין נתוני צעדים מהשירות"
        return runCatching { api.uploadHealth(JSONArray().put(JSONObject().put("date", LocalDate.now().toString()).put("steps", steps))); "נשלח" }
            .getOrElse { "השרת דחה (הפעילו בריאות במרכז הפרטיות)" }
    }
}

object StepStore { @Volatile var today: Long? = null }
