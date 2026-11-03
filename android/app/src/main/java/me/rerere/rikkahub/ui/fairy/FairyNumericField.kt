package me.rerere.rikkahub.ui.fairy

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Slider
import androidx.compose.material3.rememberSliderState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import me.rerere.rikkahub.R
import java.math.BigDecimal
import java.math.BigInteger
import kotlin.math.roundToInt

/**
 * One deployment number as the shared numeric control edits it.
 *
 * [label] and [unit] are already localized and [min]/[max] are inclusive
 * display units. [scale] converts one display unit into the stored integer:
 * 1000 for a threshold edited in K tokens, 1 for a plain count. [step] is the
 * slider's display granularity, so the compaction threshold moves in 1K steps.
 */
data class FairyNumericSpec(
    val label: String,
    val unit: String,
    val min: Int,
    val max: Int,
    val scale: Int = 1,
    val step: Int = 1,
) {
    init {
        require(min <= max) { "FairyNumericSpec: min must not exceed max" }
        require(scale >= 1) { "FairyNumericSpec: scale must be positive" }
        require(step >= 1) { "FairyNumericSpec: step must be positive" }
    }
}

/** Why a draft cannot be submitted; the control renders the matching message. */
enum class FairyNumericError { EMPTY, NOT_A_NUMBER, NOT_WHOLE, OUT_OF_RANGE }

/** The stored integer one draft text means, or the reason it cannot be submitted. */
data class FairyNumericParse(val stored: Int?, val error: FairyNumericError?) {
    val valid: Boolean get() = stored != null
}

/** Plain decimal syntax: no grouping, exponent or unit suffix; a sign is a range error, not noise. */
private val DECIMAL = Regex("^-?[0-9]+(?:\\.[0-9]+)?$")

/**
 * Parse one draft in display units into the integer the deployment stores.
 *
 * The conversion is exact: a draft that would need rounding to become a whole
 * stored unit is [FairyNumericError.NOT_WHOLE], never silently truncated. An
 * out-of-range draft keeps its text and returns no value; the caller must not
 * substitute the boundary.
 */
fun parseFairyNumeric(text: String, spec: FairyNumericSpec): FairyNumericParse {
    val trimmed = text.trim()
    if (trimmed.isEmpty()) return FairyNumericParse(null, FairyNumericError.EMPTY)
    if (!DECIMAL.matches(trimmed)) return FairyNumericParse(null, FairyNumericError.NOT_A_NUMBER)
    val scaled = BigDecimal(trimmed).multiply(BigDecimal.valueOf(spec.scale.toLong()))
    if (scaled < BigDecimal.valueOf(spec.min.toLong() * spec.scale)
        || scaled > BigDecimal.valueOf(spec.max.toLong() * spec.scale)) {
        return FairyNumericParse(null, FairyNumericError.OUT_OF_RANGE)
    }
    val stored = try {
        scaled.toBigIntegerExact()
    } catch (_: ArithmeticException) {
        return FairyNumericParse(null, FairyNumericError.NOT_WHOLE)
    }
    if (stored > BigInteger.valueOf(Int.MAX_VALUE.toLong())) {
        return FairyNumericParse(null, FairyNumericError.OUT_OF_RANGE)
    }
    return FairyNumericParse(stored.toInt(), null)
}

/** Render one stored integer in the control's display units, exactly. */
fun formatFairyNumeric(stored: Int, spec: FairyNumericSpec): String {
    if (spec.scale == 1) return stored.toString()
    return BigDecimal.valueOf(stored.toLong())
        .divide(BigDecimal.valueOf(spec.scale.toLong()))
        .stripTrailingZeros()
        .toPlainString()
}

/**
 * The one draft both the slider and the text field edit.
 *
 * [text] is the display-unit draft the field shows verbatim. [sliderStored] is
 * the last value that parsed, so an invalid draft blocks submission without
 * making the slider jump; [slide] snaps a drag to [FairyNumericSpec.step] and
 * writes the resulting text back into the same draft.
 */
@Stable
class FairyNumericDraftState internal constructor(
    val spec: FairyNumericSpec,
    initialStored: Int,
) {
    var text by mutableStateOf(formatFairyNumeric(initialStored, spec))
        private set

    var sliderStored by mutableIntStateOf(initialStored)
        private set

    val parsed: FairyNumericParse get() = parseFairyNumeric(text, spec)

    /** Replace the draft with text the user typed; never normalizes or clamps it. */
    fun input(next: String) {
        text = next
        parseFairyNumeric(next, spec).stored?.let { sliderStored = it }
    }

    /** Move the draft with the slider: snap to the display step and clamp the drag. */
    fun slide(display: Double) {
        val snapped = (display / spec.step).roundToInt() * spec.step
        val bounded = snapped.coerceIn(spec.min, spec.max)
        sliderStored = (bounded.toLong() * spec.scale).toInt()
        text = formatFairyNumeric(sliderStored, spec)
    }
}

/**
 * One remembered draft for a setting, reset when the backend's stored value
 * changes (a successful save is followed by a fresh read of the same value).
 */
@Composable
fun rememberFairyNumericDraftState(spec: FairyNumericSpec, stored: Int): FairyNumericDraftState =
    remember(spec, stored) { FairyNumericDraftState(spec, stored) }

/**
 * The reusable numeric composite: a Material 3 slider and a direct input that
 * edit one draft, with the unit, the allowed range, a visible error for an
 * invalid draft, and a busy/disabled state.
 *
 * The caller owns submission: [FairyNumericDraftState.parsed] is the value to
 * send, and it is null while the draft is invalid. No dependency is added here;
 * the slider and the text field come from the Material 3 already in the app.
 */
@Composable
fun FairyNumericField(
    state: FairyNumericDraftState,
    busy: Boolean,
    enabled: Boolean = true,
    tagPrefix: String = "fairy_numeric",
) {
    val spec = state.spec
    val error = state.parsed.error
    val active = enabled && !busy
    val sliderFloor = (spec.min.toLong() * spec.scale).coerceAtMost(Int.MAX_VALUE.toLong()).toInt()
    val sliderCeiling = (spec.max.toLong() * spec.scale).coerceAtMost(Int.MAX_VALUE.toLong()).toInt()

    OutlinedTextField(
        value = state.text,
        onValueChange = state::input,
        label = { Text(spec.label) },
        suffix = { Text(spec.unit) },
        supportingText = {
            Text(
                text = when (error) {
                    null -> stringResource(R.string.fairy_numeric_range, spec.min, spec.max, spec.unit)
                    FairyNumericError.EMPTY, FairyNumericError.NOT_A_NUMBER ->
                        stringResource(R.string.fairy_numeric_enter_number)
                    FairyNumericError.NOT_WHOLE -> if (spec.scale == 1) {
                        stringResource(R.string.fairy_numeric_enter_whole_number)
                    } else {
                        stringResource(R.string.fairy_numeric_decimal_places, decimalPlaces(spec.scale))
                    }
                    FairyNumericError.OUT_OF_RANGE ->
                        stringResource(R.string.fairy_numeric_out_of_range, spec.min, spec.max, spec.unit)
                },
            )
        },
        isError = error != null,
        singleLine = true,
        enabled = active,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
        modifier = Modifier.fillMaxWidth().testTag("${tagPrefix}_input"),
    )
    // The slider is a view of the same draft: a typed value moves the thumb, and
    // a drag writes the snapped display value back into the text field.
    val sliderPosition = state.sliderStored.coerceIn(sliderFloor, sliderCeiling).toFloat() / spec.scale
    val sliderState = rememberSliderState(
        value = sliderPosition,
        steps = 0,
        trackRange = spec.min.toFloat()..spec.max.toFloat(),
    )
    LaunchedEffect(sliderPosition) {
        if (sliderState.value != sliderPosition) sliderState.value = sliderPosition
    }
    Slider(
        state = sliderState,
        onValueChange = { state.slide(it.toDouble()) },
        enabled = active,
        modifier = Modifier.fillMaxWidth().testTag("${tagPrefix}_slider"),
    )
}

/** Digits behind the decimal point a display unit of `scale` can express. */
private fun decimalPlaces(scale: Int): Int {
    var remaining = scale
    var places = 0
    while (remaining > 1 && remaining % 10 == 0) {
        remaining /= 10
        places += 1
    }
    return places
}
