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
import androidx.compose.foundation.text.TextAutoSize
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
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import me.rerere.rikkahub.data.remote.AccountSession
import me.rerere.rikkahub.data.remote.Bill
import me.rerere.rikkahub.data.remote.BillBackend
import me.rerere.rikkahub.data.remote.BillDay
import me.rerere.rikkahub.data.remote.BillFailure
import me.rerere.rikkahub.data.remote.BillState
import me.rerere.rikkahub.data.remote.BillTotal
import java.math.BigDecimal
import java.math.RoundingMode

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
 * Each column prints the backend's Denny and the count it stands for, both in
 * compact units. Neither is derived here — no rate is applied on this page.
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
            text = billDennyFigure(total.denny),
            fontFamily = tokens.telemetryFontFamily,
            fontWeight = FontWeight.Bold,
            fontSize = 15.sp,
            color = tokens.signal,
            maxLines = 1,
            // The figure keeps its size; if a very narrow screen plus a large system
            // font still cannot hold it, it steps down rather than losing a digit.
            autoSize = TextAutoSize.StepBased(minFontSize = 11.sp, maxFontSize = 15.sp, stepSize = 1.sp),
        )
        Text(
            text = billCountText(total.tokens.total),
            fontFamily = tokens.telemetryFontFamily,
            fontSize = 10.sp,
            color = tokens.textMuted,
            maxLines = 1,
            autoSize = TextAutoSize.StepBased(minFontSize = 8.sp, maxFontSize = 10.sp, stepSize = 1.sp),
        )
    }
}

/** The unit word that follows a Denny figure, in the size the column can spare. */
private const val BILL_DENNY_UNIT = " 丁尼"

/**
 * The unit's size relative to the figure's, so it shrinks with it.
 *
 * A fixed size would stay put while [Builder.autoSize] stepped the figure down,
 * and on the narrowest viewport that left the full-size unit as the part that
 * still did not fit.
 */
private const val BILL_DENNY_UNIT_EM = 0.62f

/**
 * The Denny line: its figure at the column's own size, its unit smaller.
 *
 * The unit is a constant word, so setting it below the figure's size costs no
 * meaning and buys the width a three-way column does not have — at 320dp and a
 * large system font the full-size unit was what pushed the figure into an
 * ellipsis. The text is built from [billDennyText] rather than alongside it, so
 * there is one formatting rule and one place to change it.
 */
private fun billDennyFigure(denny: Double): AnnotatedString {
    val figure = billDennyText(denny).removeSuffix(BILL_DENNY_UNIT)
    return buildAnnotatedString {
        append(figure)
        withStyle(SpanStyle(fontSize = BILL_DENNY_UNIT_EM.em)) { append(BILL_DENNY_UNIT) }
    }
}

/** The backend's Denny in a compact unit, one decimal: 0.7, 20.0, 1.2K, 3.4M, 5.6B. */
internal fun billDennyText(denny: Double): String =
    "${billAmountText(denny)}$BILL_DENNY_UNIT"

/**
 * The raw count behind a Denny figure, in the same compact units.
 *
 * The count below a thousand stays exact; from a thousand up it takes a K, M, B
 * or T suffix and one decimal, so the line fits the narrow column the totals
 * share. Rounding ends at one decimal: the figure sits beside the Denny total as
 * a magnitude, not as an audit trail.
 */
internal fun billCountText(count: Long): String =
    if (count < 1_000L) count.toString() else billAmountText(count.toDouble())

/** Each suffix and the figure it stands for, from the plain unit up to a trillion. */
private val BillUnits = listOf(
    "" to BigDecimal.ONE,
    "K" to BigDecimal.valueOf(1_000),
    "M" to BigDecimal.valueOf(1_000_000),
    "B" to BigDecimal.valueOf(1_000_000_000),
    "T" to BigDecimal.valueOf(1_000_000_000_000),
)

/** The first printed figure that no longer fits in a unit without losing a digit. */
private val BillUnitCeiling = BigDecimal.valueOf(1_000)

/**
 * One non-negative figure in the largest unit that still fits, keeping a tenth.
 *
 * The tenth is rounded before the unit is chosen, so a figure that would print as
 * four digits — 999,999 — reads as 1.0M instead of as 1000.0K. [BillUnits] stops
 * at T; a figure past a trillion keeps the T and grows with it.
 *
 * The result is built from a decimal rather than from `String.format`, so the
 * separator is a dot whatever the phone's locale is: this page's copy is Chinese
 * regardless of it.
 */
private fun billAmountText(value: Double): String {
    val amount = BigDecimal.valueOf(value)
    val (suffix, scale) = BillUnits.firstOrNull { (_, scale) -> billTenths(amount, scale) < BillUnitCeiling }
        ?: BillUnits.last()
    return billTenths(amount, scale).toPlainString() + suffix
}

/** [amount] over [scale], rounded half up to the one decimal the page prints. */
private fun billTenths(amount: BigDecimal, scale: BigDecimal): BigDecimal =
    amount.divide(scale, 1, RoundingMode.HALF_UP)

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
