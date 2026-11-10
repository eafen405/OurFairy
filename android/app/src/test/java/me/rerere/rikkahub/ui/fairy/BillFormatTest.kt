package me.rerere.rikkahub.ui.fairy

import org.junit.Assert.assertEquals
import org.junit.Test
import java.util.Locale

/**
 * #341: the bill's figures in compact K/M/B units, one decimal.
 *
 * The totals share three narrow columns, so a long all-time figure used to be
 * ellipsized. These cases pin the formatting rule the page relies on: plain below
 * a thousand, a suffix and one decimal from a thousand up, and never a fourth
 * digit — a figure that would round up into one moves to the next unit instead.
 */
class BillFormatTest {

    @Test
    fun `Denny below a thousand keeps its one decimal and unit`() {
        assertEquals("0.0 丁尼", billDennyText(0.0))
        assertEquals("0.7 丁尼", billDennyText(0.7))
        assertEquals("20.0 丁尼", billDennyText(20.0))
        assertEquals("200.0 丁尼", billDennyText(200.0))
        assertEquals("999.9 丁尼", billDennyText(999.9))
    }

    @Test
    fun `Denny from a thousand up uses K M and B with one decimal`() {
        assertEquals("1.0K 丁尼", billDennyText(1_000.0))
        assertEquals("1.2K 丁尼", billDennyText(1_234.5))
        assertEquals("12.3K 丁尼", billDennyText(12_345.6))
        assertEquals("600.0K 丁尼", billDennyText(600_000.0))
        assertEquals("1.2M 丁尼", billDennyText(1_234_567.8))
        assertEquals("1.2B 丁尼", billDennyText(1_234_567_890.0))
        assertEquals("1.2T 丁尼", billDennyText(1_234_567_890_123.0))
    }

    @Test
    fun `token counts below a thousand stay exact`() {
        assertEquals("0", billCountText(0))
        assertEquals("999", billCountText(999))
    }

    @Test
    fun `token counts from a thousand up use K M and B with one decimal`() {
        assertEquals("1.0K", billCountText(1_000))
        assertEquals("2.0K", billCountText(2_000))
        assertEquals("60.0K", billCountText(60_000))
        assertEquals("600.0K", billCountText(600_000))
        assertEquals("1.2M", billCountText(1_234_567))
        assertEquals("1.2B", billCountText(1_234_567_890))
    }

    @Test
    fun `rounding to one decimal carries into the next unit instead of printing four digits`() {
        assertEquals("1.0M", billCountText(999_999))
        assertEquals("1.0M 丁尼", billDennyText(999_999.0))
        assertEquals("1.0M", billCountText(999_950))
        // The largest unit the page has: past a trillion the figure keeps the T.
        assertEquals("1234.6T", billCountText(1_234_567_890_123_456))
    }

    @Test
    fun `the separator is a dot whatever the phone's locale is`() {
        val phone = Locale.getDefault()
        try {
            // German prints a comma for the decimal separator; this page must not.
            Locale.setDefault(Locale.GERMANY)
            assertEquals("1.2K 丁尼", billDennyText(1_234.5))
            assertEquals("1.2K", billCountText(1_234))
        } finally {
            Locale.setDefault(phone)
        }
    }
}
