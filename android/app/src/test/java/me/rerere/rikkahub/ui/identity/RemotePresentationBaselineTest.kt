package me.rerere.rikkahub.ui.identity

import java.io.File
import me.rerere.ui.markdown.parseMarkdown
import org.junit.Assert.assertEquals
import org.junit.Test

/** Host parsing baseline only; neither Android frames nor a device performance acceptance test. */
class RemotePresentationBaselineTest {
    @Test fun `record fixed complete document parsing baseline`() {
        val unit = File("src/perf/assets/presentation/workload.md").readText()
        val source = List(64) { unit }.joinToString("\n")
        repeat(2) { parseMarkdown(source) }
        val timings = List(7) {
            val started = System.nanoTime()
            val document = parseMarkdown(source)
            assertEquals(source, document.source)
            (System.nanoTime() - started) / 1_000_000.0
        }.sorted()
        println("PRESENTATION_HOST_BASELINE chars=${source.length} samples=${timings.joinToString(",")} medianMs=${timings[3]} p95Ms=${timings[6]}")
    }

    /**
     * The combined workload (#268) is a fixed declaration, not an inference.
     *
     * `src/perf/assets/presentation/multi-session.md` is the whole declaration the measurement
     * activity parses, and a round on a device is only comparable with another round that names the
     * same numbers. Pinning the file here makes a change deliberate: editing the workload fails this
     * test until the new numbers are written down, instead of silently producing a new baseline that
     * looks like the old one.
     *
     * This asserts the declaration, not the activity's reader — the activity lives in `src/perf`,
     * which the debug unit-test variant does not compile, so the same file is the shared authority.
     */
    @Test fun `multi-session combined workload declaration stays fixed`() {
        val declared = File("src/perf/assets/presentation/multi-session.md").readLines()
            .map { it.trim() }
            .filter { it.isNotEmpty() && !it.startsWith("#") }
        assertEquals(
            listOf(
                "sessions = 6",
                "historySessions = 5",
                "historyMessages = 200",
                "streamingSessions = 1",
                "replyChars = 232703",
                "chunkChars = 128",
                "intervalMillis = 20",
            ),
            declared,
        )
    }

    /**
     * The combined reply is the #74 `stream` tier's body, repeated exactly 64 times.
     *
     * `stream` joins `LONG_REPLY_REPEATS = 64` copies of `workload.md` with a newline, so its
     * reply is `64 * body.length + 63`. The declaration's `replyChars` must equal that number:
     * changing the body (or the repetition rule) fails here until the combined workload is
     * re-declared, instead of silently measuring a different length under the same name.
     */
    @Test fun `the combined reply reuses the single-session stream body`() {
        val body = File("src/perf/assets/presentation/workload.md").readText()
        val declared = File("src/perf/assets/presentation/multi-session.md").readLines()
            .map { it.trim() }
            .filter { it.isNotEmpty() && !it.startsWith("#") }
            .associate { line -> line.substringBefore("=").trim() to line.substringAfter("=").trim() }
        assertEquals(
            List(64) { body }.joinToString("\n").length,
            declared.getValue("replyChars").toInt(),
        )
    }
}
