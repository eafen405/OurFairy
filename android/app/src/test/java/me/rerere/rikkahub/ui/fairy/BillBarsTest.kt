package me.rerere.rikkahub.ui.fairy

import me.rerere.rikkahub.data.remote.BillDay
import me.rerere.rikkahub.data.remote.BillTokens
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The chart's layout, as a pure fold over the series the backend sent.
 *
 * The canvas is not readable through semantics, so the one thing the page derives
 * — a bar per day and its height against the series' own peak — is asserted here,
 * and the page test asserts that the canvas exists with that many bars. The cases
 * are the ticket's own: exactly 30 bars for a 30-day series, and a zero day kept
 * at zero rather than dropped.
 */
class BillBarsTest {

    private fun day(day: String, tokens: Long) = BillDay(
        day = day,
        tokens = BillTokens(inputTokens = tokens),
        denny = tokens / 3000.0,
    )

    @Test
    fun `a thirty day series is thirty bars, in the order it arrived`() {
        val days = (0 until 30).map { index -> day("2026-10-${(index + 1).toString().padStart(2, '0')}", index * 3000L) }

        val bars = billBars(days)

        assertEquals("a bar per day, none invented and none dropped", 30, bars.size)
        assertEquals("2026-10-01", bars.first().day.day)
        assertEquals("2026-10-30", bars.last().day.day)
    }

    @Test
    fun `a day with no spend keeps its bar at zero height`() {
        val days = listOf(day("2026-10-01", 0), day("2026-10-02", 6000), day("2026-10-03", 0))

        val bars = billBars(days)

        assertEquals("the zero days are still bars", 3, bars.size)
        assertEquals("and their height is exactly zero", 0f, bars[0].fraction, 0.0001f)
        assertEquals(0f, bars[2].fraction, 0.0001f)
    }

    @Test
    fun `the busiest day in view is the full height and the rest scale to it`() {
        val days = listOf(day("2026-10-01", 1500), day("2026-10-02", 3000), day("2026-10-03", 750))

        val bars = billBars(days)

        assertEquals("the peak is the full plot", 1f, bars[1].fraction, 0.0001f)
        assertEquals("half the peak is half the plot", 0.5f, bars[0].fraction, 0.0001f)
        assertEquals(0.25f, bars[2].fraction, 0.0001f)
    }

    @Test
    fun `a series with no spend at all is a flat floor, not a division by zero`() {
        val bars = billBars(List(30) { day("2026-10-${it + 1}", 0) })

        assertEquals(30, bars.size)
        assertTrue("every bar is zero height", bars.all { it.fraction == 0f })
        assertTrue("and none of them is NaN", bars.all { !it.fraction.isNaN() })
    }

    @Test
    fun `an empty series is no bars rather than a fabricated thirty`() {
        assertEquals(emptyList<BillBar>(), billBars(emptyList()))
    }
}
