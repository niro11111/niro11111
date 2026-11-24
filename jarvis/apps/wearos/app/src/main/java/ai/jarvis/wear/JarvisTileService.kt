package ai.jarvis.wear

import androidx.wear.protolayout.ColorBuilders.argb
import androidx.wear.protolayout.LayoutElementBuilders
import androidx.wear.protolayout.ResourceBuilders
import androidx.wear.protolayout.TimelineBuilders
import androidx.wear.protolayout.material.Text
import androidx.wear.protolayout.material.Typography
import androidx.wear.tiles.RequestBuilders
import androidx.wear.tiles.TileBuilders
import androidx.wear.tiles.TileService
import com.google.common.util.concurrent.ListenableFuture
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.guava.future

/** Glanceable tile: pending approvals and the next task. Refreshes every 15 minutes. */
class JarvisTileService : TileService() {
    private val scope = CoroutineScope(Dispatchers.IO)

    override fun onTileRequest(req: RequestBuilders.TileRequest): ListenableFuture<TileBuilders.Tile> = scope.future {
        val g = runCatching { JarvisApi(this@JarvisTileService).glance() }.getOrNull()
        val approvals = g?.optJSONArray("approvals")?.length() ?: 0
        val next = g?.optJSONArray("tasks")?.optJSONObject(0)?.optString("title") ?: "—"
        val text = if (g == null) "JARVIS לא זמין" else if (approvals > 0) "$approvals אישורים ממתינים" else next
        val layout = LayoutElementBuilders.Column.Builder()
            .addContent(Text.Builder(this@JarvisTileService, "JARVIS").setTypography(Typography.TYPOGRAPHY_CAPTION1).setColor(argb(0xFF2EE6FF.toInt())).build())
            .addContent(Text.Builder(this@JarvisTileService, text).setTypography(Typography.TYPOGRAPHY_BODY1).setColor(argb(if (approvals > 0) 0xFFFFBF3C.toInt() else 0xFFE6F6FF.toInt())).setMaxLines(2).build())
            .build()
        TileBuilders.Tile.Builder().setResourcesVersion("1").setFreshnessIntervalMillis(15 * 60 * 1000L)
            .setTileTimeline(TimelineBuilders.Timeline.fromLayoutElement(layout)).build()
    }

    override fun onTileResourcesRequest(req: RequestBuilders.ResourcesRequest): ListenableFuture<ResourceBuilders.Resources> =
        scope.future { ResourceBuilders.Resources.Builder().setVersion("1").build() }
}
