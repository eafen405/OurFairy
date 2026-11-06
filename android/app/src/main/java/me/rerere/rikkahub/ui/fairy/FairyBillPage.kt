package me.rerere.rikkahub.ui.fairy

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import me.rerere.rikkahub.data.remote.AccountSession
import me.rerere.rikkahub.data.remote.Bill
import me.rerere.rikkahub.data.remote.BillBackend
import me.rerere.rikkahub.data.remote.BillDay
import me.rerere.rikkahub.data.remote.BillFailure
import me.rerere.rikkahub.data.remote.BillState
import me.rerere.rikkahub.data.remote.BillTotal
import java.util.Locale

/** The chart's plot height above its baseline. */
private val BillChartHeight = 132.dp

/** How much of a day's slot the bar fills; the rest is the gap that keeps 30 bars apart. */
private const val BILL_BAR_FILL = 0.62f

/**
 * The chart's reading of the series: one entry per day the wire sent, in order.
 *
 * A day whose spend is zero stays in the list with [fraction] 0 — it gets its slot
 * and its floor mark, and is never dropped — because a missing bar would be read as
 * a day the bill failed to measure rather than a day nothing was spent (#322,
 * user story 25). The fraction is against the series' own peak, so the busiest day
 * in view is the full height whatever the deployment's absolute scale.
 */
internal data class BillBar(val day: BillDay, val fraction: Float)

/** One entry per day, zero-spend days included at zero height. */
internal fun billBars(days: List<BillDay>): List<BillBar> {
    val peak = days.maxOfOrNull { it.tokens.total } ?: 0L
    // A series with no spend at all is a flat floor, not a division by zero.
    val scale = if (peak <= 0L) 0f else peak.toFloat()
    return days.map { day ->
        BillBar(day = day, fraction = if (scale == 0f) 0f else day.tokens.total / scale)
    }
}

/**
 * The bill page: three totals in both units, and the trailing 30-day series drawn
 * by hand.
 *
 * The page renders only what `/bill` answered. It never adds up buckets itself and
 * never converts tokens to Denny — the rate is the backend's narrative constant,
 * and a second copy of it here would be a second answer the day it moved. The one
 * derivation is the chart's scale, which is relative to the series it is given.
 *
 * Three states are kept apart on purpose. While a first read is in flight there is
 * nothing to show and the page says it is reading; when a read fails the page shows
 * the failure and no figures, because "nothing was spent" and "could not compute"
 * must not look the same (#322, user story 43); a successfully read zero bill is
 * the empty state below, with its totals still printed.
 */
@Composable
fun FairyBillPage(
    onBack: () -> Unit,
    session: AccountSession,
    backend: BillBackend,
) {
    val tokens = LocalFairyTokens.current
    val identity by session.identity.collectAsStateWithLifecycle()
    val token = identity?.token
    val scope = rememberCoroutineScope()
    val state = remember(backend, scope) { BillState(backend, scope) }
    LaunchedEffect(token) {
        if (token != null) state.load(token)
    }
    val snapshot by state.snapshot.collectAsStateWithLifecycle()
    val bill = snapshot.bill

    Box(Modifier.fillMaxSize()) {
        FairyBackground(watermark = false)
        Column(
            modifier = Modifier
                .fillMaxSize()
                .statusBarsPadding()
                .padding(top = FairyWindowBarHeight)
                .navigationBarsPadding()
                .padding(horizontal = 16.dp)
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.Top,
        ) {
            Text(
                text = "这台 Fairy 的电费：今日、本月与历史以来，以及最近 30 天的走势。账单只有这一台 Fairy 的合计，不按用户拆分。",
                style = MaterialTheme.typography.bodySmall,
                color = tokens.textMuted,
            )

            if (token == null) {
                Spacer(Modifier.height(16.dp))
                Text(
                    text = "请先登录后再查看账单。",
                    style = MaterialTheme.typography.bodyMedium,
                    color = tokens.textPrimary,
                )
            }

            when {
                // A first read has not answered yet: no figures, and no chart of zeros.
                bill == null && snapshot.loading -> {
                    Spacer(Modifier.height(16.dp))
                    Row(
                        modifier = Modifier.fillMaxWidth().testTag("bill-loading"),
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        CircularProgressIndicator()
                        Text("正在读取账单…", style = MaterialTheme.typography.bodyMedium, color = tokens.textMuted)
                    }
                }

                // No bill and not loading: this is a failure, never an empty bill.
                bill == null -> {
                    if (token != null) {
                        BillFailureBanner(snapshot.failure)
                        Spacer(Modifier.height(12.dp))
                        SignalButton(
                            text = "重新读取",
                            tag = "RETRY",
                            variant = SignalButtonVariant.SECONDARY,
                            onClick = { state.load(token) },
                            enabled = !snapshot.loading,
                            modifier = Modifier.fillMaxWidth().testTag("bill-retry"),
                        )
                    }
                }

                else -> {
                    // A later read may fail on top of a bill already read; the figures
                    // stay and the failure is reported beside them.
                    if (snapshot.failure != null) {
                        BillFailureBanner(snapshot.failure)
                    }
                    Spacer(Modifier.height(16.dp))
                    if (bill.isEmpty) {
                        Text(
                            text = "这台 Fairy 目前没有电费消耗记录。",
                            style = MaterialTheme.typography.bodyMedium,
                            color = tokens.textMuted,
                        )
                        Spacer(Modifier.height(12.dp))
                    }
                    BillTotals(bill)
                    Spacer(Modifier.height(16.dp))
                    BillChartPanel(bill.days)
                    Spacer(Modifier.height(14.dp))
                    Text(
                        text = "汇率是叙事设定，不是市场价：每 3000 原始用量记为 1 丁尼。",
                        style = MaterialTheme.typography.bodySmall,
                        color = tokens.textMuted.copy(alpha = 0.85f),
                    )
                    Spacer(Modifier.height(4.dp))
                    Text(
                        text = "标题生成等辅助调用不产生账单，进程被终止时未完成的回合也不计入。",
                        style = MaterialTheme.typography.bodySmall,
                        color = tokens.textMuted.copy(alpha = 0.7f),
                    )
                    if (snapshot.loading) {
                        Spacer(Modifier.height(8.dp))
                        Text("正在刷新…", style = MaterialTheme.typography.bodySmall, color = tokens.textMuted)
                    }
                }
            }

            Spacer(Modifier.height(24.dp))
        }
        FairyWindowTopBar(
            window = FairyWindowState(FairyPresence.IDLE),
            subtitle = "电费账单",
            onNavigateBack = onBack,
        )
    }
}

/**
 * The three totals in one instrument cluster.
 *
 * Each column prints the backend's Denny and the raw count it stands for. Neither is
 * derived here — no rate is applied on this page.
 */
@Composable
private fun BillTotals(bill: Bill) {
    val tokens = LocalFairyTokens.current
    InstrumentPanel(
        modifier = Modifier
            .fillMaxWidth()
            .testTag("bill-totals"),
        level = InstrumentLevel.RAISED,
    ) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            BillTotalColumn("今日", "TODAY", bill.today, Modifier.weight(1f).testTag("bill-total-today"))
            BillTotalColumn("本月", "MONTH", bill.month, Modifier.weight(1f).testTag("bill-total-month"))
            BillTotalColumn("历史以来", "ALL TIME", bill.allTime, Modifier.weight(1f).testTag("bill-total-all-time"))
        }
    }
}

@Composable
private fun BillTotalColumn(label: String, tag: String, total: BillTotal, modifier: Modifier = Modifier) {
    val tokens = LocalFairyTokens.current
    Column(modifier) {
        Text(
            text = label,
            fontFamily = tokens.functionFontFamily,
            fontWeight = FontWeight.Bold,
            fontSize = 13.sp,
            color = tokens.textPrimary,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Text(
            text = tag,
            fontFamily = tokens.telemetryFontFamily,
            fontSize = 9.sp,
            letterSpacing = 0.8.sp,
            color = tokens.textMuted,
            modifier = Modifier.fairySlant(),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Spacer(Modifier.height(8.dp))
        Text(
            text = billDennyText(total.denny),
            fontFamily = tokens.telemetryFontFamily,
            fontWeight = FontWeight.Bold,
            fontSize = 15.sp,
            color = tokens.signal,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Text(
            text = billCountText(total.tokens.total),
            fontFamily = tokens.telemetryFontFamily,
            fontSize = 10.sp,
            color = tokens.textMuted,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/** The backend's Denny to a tenth, in the unit's own name. */
internal fun billDennyText(denny: Double): String =
    String.format(Locale.ROOT, "%.1f 丁尼", denny)

/**
 * The raw count behind a Denny figure, grouped so it can be read at a glance.
 *
 * It is printed as the number alone: 丁尼 is the bill's unit and the word for the
 * underlying measure belongs to the spec, not to a label on this page. The count
 * stays exact — rounding it would defeat the point of showing it beside the
 * converted figure. `Locale.ROOT` keeps the grouping stable whatever the phone's
 * locale is, because this page's copy is Chinese regardless of it.
 */
internal fun billCountText(count: Long): String =
    String.format(Locale.ROOT, "%,d", count)

/** The series as an instrument readout: its span, 30 hand-drawn bars, and its date range. */
@Composable
private fun BillChartPanel(days: List<BillDay>) {
    val tokens = LocalFairyTokens.current
    val bars = remember(days) { billBars(days) }
    InstrumentPanel(
        modifier = Modifier.fillMaxWidth(),
        level = InstrumentLevel.RECESSED,
        chamfered = true,
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = "最近 30 天",
                fontFamily = tokens.functionFontFamily,
                fontWeight = FontWeight.Bold,
                fontSize = 14.sp,
                color = tokens.textPrimary,
                modifier = Modifier.weight(1f),
            )
            Text(
                text = "${bars.size} DAYS",
                fontFamily = tokens.telemetryFontFamily,
                fontSize = 9.sp,
                letterSpacing = 0.8.sp,
                color = tokens.textMuted,
                modifier = Modifier.fairySlant(),
            )
        }
        Spacer(Modifier.height(12.dp))
        BillChart(bars = bars, height = BillChartHeight)
        Spacer(Modifier.height(6.dp))
        if (days.isNotEmpty()) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(
                    text = days.first().day,
                    fontFamily = tokens.telemetryFontFamily,
                    fontSize = 9.sp,
                    color = tokens.textMuted,
                )
                Text(
                    text = days.last().day,
                    fontFamily = tokens.telemetryFontFamily,
                    fontSize = 9.sp,
                    color = tokens.textMuted,
                )
            }
        }
    }
}

/**
 * The 30 bars, drawn by hand on a [Canvas].
 *
 * No charting dependency: the whole drawing is a slot per day and a rectangle in
 * it. The baseline is always drawn, and a day with no spend draws a small floor
 * mark at that baseline instead of a bar — so the day is present and visibly
 * measured at zero, which is exactly the distinction a skipped day would lose.
 */
@Composable
private fun BillChart(bars: List<BillBar>, height: Dp) {
    val tokens = LocalFairyTokens.current
    val description = "最近 30 天走势，共 ${bars.size} 根柱子"
    Canvas(
        Modifier
            .fillMaxWidth()
            .height(height)
            .testTag("bill-chart")
            .semantics { contentDescription = description },
    ) {
        val hairline = 1.dp.toPx()
        val baseline = size.height - hairline
        val plot = baseline - 4.dp.toPx()
        drawLine(
            color = tokens.hairline,
            start = Offset(0f, baseline),
            end = Offset(size.width, baseline),
            strokeWidth = hairline,
        )
        if (bars.isEmpty()) return@Canvas
        val slot = size.width / bars.size
        val barWidth = (slot * BILL_BAR_FILL).coerceAtLeast(hairline)
        val face = Brush.verticalGradient(
            0f to tokens.signal.copy(alpha = 0.85f),
            1f to tokens.fairyLink.copy(alpha = 0.32f),
            startY = 0f,
            endY = baseline,
        )
        bars.forEachIndexed { index, bar ->
            val left = index * slot + (slot - barWidth) / 2f
            if (bar.fraction > 0f) {
                val barHeight = (plot * bar.fraction).coerceAtLeast(hairline * 2f)
                drawRect(
                    brush = face,
                    topLeft = Offset(left, baseline - barHeight),
                    size = Size(barWidth, barHeight),
                )
            } else {
                // Zero is a measured value, not a gap: the day keeps its slot and a
                // floor mark, so nobody reads a hole in the series as missing data.
                drawRect(
                    color = tokens.textMuted.copy(alpha = 0.45f),
                    topLeft = Offset(left, baseline - hairline * 1.5f),
                    size = Size(barWidth, hairline * 1.5f),
                )
            }
        }
    }
}

/** The backend's own words, or the localized "unreachable" for a lost connection. */
@Composable
private fun BillFailureBanner(failure: BillFailure?) {
    if (failure == null) return
    val tokens = LocalFairyTokens.current
    Spacer(Modifier.height(12.dp))
    Text(
        text = if (failure.unreachable) {
            "无法连接服务端。"
        } else {
            "${failure.code}: ${failure.message}"
        },
        style = MaterialTheme.typography.bodySmall,
        color = tokens.danger,
        modifier = Modifier.testTag("bill-failure"),
    )
}
