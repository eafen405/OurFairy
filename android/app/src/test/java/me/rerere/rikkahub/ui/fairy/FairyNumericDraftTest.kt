package me.rerere.rikkahub.ui.fairy

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The shared numeric control's value rules, exercised without Compose.
 *
 * The two consumers use the same draft, parsing and range rules: the compaction
 * threshold is edited in K tokens and stored as whole tokens, while the later
 * maintenance numbers are plain integers. Expected values come from the ticket
 * contract (100K–900K, whole stored tokens, no clamping), not from the parser.
 */
class FairyNumericDraftTest {

    private val tokens = FairyNumericSpec(
        label = "Threshold",
        unit = "K token",
        min = 100,
        max = 900,
        scale = 1000,
    )

    private val turns = FairyNumericSpec(
        label = "Turns",
        unit = "turns",
        min = 5,
        max = 50,
    )

    @Test
    fun `a K draft becomes whole tokens without rounding`() {
        assertEquals(700_000, parseFairyNumeric("700", tokens).stored)
        assertEquals(500_000, parseFairyNumeric("500", tokens).stored)
        assertEquals("a stored value that is not a whole K still converts exactly", 500_500, parseFairyNumeric("500.5", tokens).stored)
        assertEquals("500", formatFairyNumeric(500_000, tokens))
        assertEquals("500.5", formatFairyNumeric(500_500, tokens))
    }

    @Test
    fun `a value outside the range is reported and never clamped`() {
        for (text in listOf("99", "901", "1000", "-500")) {
            val parsed = parseFairyNumeric(text, tokens)
            assertNull("$text must not become a value", parsed.stored)
            assertEquals("$text must be an out-of-range error", FairyNumericError.OUT_OF_RANGE, parsed.error)
        }
        assertEquals("the lower boundary is inclusive", 100_000, parseFairyNumeric("100", tokens).stored)
        assertEquals("the upper boundary is inclusive", 900_000, parseFairyNumeric("900", tokens).stored)
    }

    @Test
    fun `a non-numeric or too-precise draft is an error, not zero`() {
        assertEquals(FairyNumericError.NOT_A_NUMBER, parseFairyNumeric("abc", tokens).error)
        assertEquals(FairyNumericError.NOT_A_NUMBER, parseFairyNumeric("5,000", tokens).error)
        assertEquals(FairyNumericError.NOT_WHOLE, parseFairyNumeric("100.0005", tokens).error)
        assertEquals(FairyNumericError.EMPTY, parseFairyNumeric("  ", tokens).error)
        assertEquals(FairyNumericError.NOT_WHOLE, parseFairyNumeric("5.5", turns).error)
        assertNull(parseFairyNumeric("abc", tokens).stored)
    }

    @Test
    fun `the slider and the direct input edit the same draft in 1K steps`() {
        val state = FairyNumericDraftState(tokens, 500_000)
        assertEquals("500", state.text)
        assertEquals(500_000, state.parsed.stored)

        state.input("700")
        assertEquals("the typed draft is the slider's draft", 700_000, state.sliderStored)
        assertEquals(700_000, state.parsed.stored)

        state.slide(300.4)
        assertEquals("300", state.text)
        assertEquals(300_000, state.parsed.stored)

        state.slide(300.6)
        assertEquals("the slider moves in whole K steps", "301", state.text)

        // An invalid typed draft stays exactly as typed, while the slider keeps
        // the last valid position and submission is blocked.
        state.input("950")
        assertEquals("950", state.text)
        assertNull(state.parsed.stored)
        assertEquals(301_000, state.sliderStored)
    }

    @Test
    fun `a plain integer setting uses the same draft with no scaling`() {
        val state = FairyNumericDraftState(turns, 15)
        assertEquals("15", state.text)
        state.input("50")
        assertEquals(50, state.parsed.stored)
        state.input("5")
        assertEquals(5, state.parsed.stored)
        state.input("51")
        assertNull(state.parsed.stored)
        assertTrue(parseFairyNumeric("15", turns).error == null)
    }
}
