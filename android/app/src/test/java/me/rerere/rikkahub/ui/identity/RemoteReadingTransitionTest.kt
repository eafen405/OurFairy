package me.rerere.rikkahub.ui.identity

import me.rerere.rikkahub.data.remote.*
import me.rerere.ui.markdown.*
import org.junit.Assert.*
import org.junit.Test

class RemoteReadingTransitionTest {
    private val source = "Reading [the ending][ref].\n\n```kotlin\nval final = 42\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n\$\$x^2\$\$\n\n[ref]: https://example.com/end"
    private val terminal = RemoteChatMessage("durable", 9, role = 2, status = 3, text = source)

    private fun attempt(id: String, text: String) =
        RemoteChatAttempt(attemptId = id, revision = 0, text = text)

    @Test fun `attempt row key spells the generation scoped attempt convention`() {
        val rows = RemoteTranscriptPresentation().update(
            messages = emptyList(),
            generation = "gen-7",
            attempt = attempt("attempt-2", "streaming"),
            settled = null,
            visibleKeys = emptySet(),
            followTail = true,
        )
        assertEquals("attempt:gen-7:attempt-2", rows.single().key)
    }

    @Test fun `reader keeps same raw layout through terminal and gets parsed complete body after leaving`() {
        val state = RemoteTranscriptPresentation()
        val live = state.update(
            messages = emptyList(),
            generation = "generation",
            attempt = attempt("live", source),
            settled = null,
            visibleKeys = emptySet(),
            followTail = true,
        ).single()
        val settlement = RemoteChatSettlement("live", terminal.seq)
        val settled = state.update(
            messages = listOf(terminal),
            generation = "generation",
            attempt = null,
            settled = settlement,
            visibleKeys = setOf(live.key),
            followTail = false,
        ).single()
        assertEquals(live.key, settled.key)
        assertEquals(live.text, settled.text)
        assertTrue(settled.deferFormatting)
        val parsed = parseMarkdown(settled.text)
        assertNull(settled.documentToShow(parsed))
        val released = state.update(
            messages = listOf(terminal),
            generation = "generation",
            attempt = null,
            settled = settlement,
            visibleKeys = emptySet(),
            followTail = false,
        ).single()
        assertSame(parsed, released.documentToShow(parsed))
        assertTrue(parsed.blocks.any { it is MarkdownBlock.CodeBlock })
        assertTrue(parsed.blocks.any { it is MarkdownBlock.Table })
        assertTrue(parsed.blocks.filterIsInstance<MarkdownBlock.Paragraph>().any { it.content.any { node -> node is MarkdownInline.Math && node.display } })
        assertEquals(1, state.update(
            messages = listOf(terminal),
            generation = "generation",
            attempt = null,
            settled = RemoteChatSettlement("unrelated", terminal.seq),
            visibleKeys = emptySet(),
            followTail = false,
        ).size)
    }

    @Test fun `return to tail releases pending formatting while history never waits for scrolling`() {
        val state = RemoteTranscriptPresentation()
        val live = state.update(
            messages = emptyList(),
            generation = "generation",
            attempt = attempt("live", source),
            settled = null,
            visibleKeys = emptySet(),
            followTail = true,
        ).single()
        val settlement = RemoteChatSettlement("live", terminal.seq)
        assertTrue(state.update(
            messages = listOf(terminal),
            generation = "generation",
            attempt = null,
            settled = settlement,
            visibleKeys = setOf(live.key),
            followTail = false,
        ).single().deferFormatting)
        val resumed = state.update(
            messages = listOf(terminal),
            generation = "generation",
            attempt = null,
            settled = settlement,
            visibleKeys = setOf(live.key),
            followTail = true,
        ).single()
        assertFalse(resumed.deferFormatting)
        assertFalse(state.update(
            messages = listOf(terminal),
            generation = "generation",
            attempt = null,
            settled = settlement,
            visibleKeys = setOf(live.key),
            followTail = false,
        ).single().deferFormatting)
        val history = RemoteTranscriptPresentation().update(
            messages = listOf(terminal),
            generation = "generation",
            attempt = null,
            settled = null,
            visibleKeys = setOf("durable"),
            followTail = false,
        ).single()
        assertFalse(history.deferFormatting)
        assertEquals("durable", history.key)
    }
    @Test fun `formal reply before stream end and unrelated delivery retain exactly one settled reading row`() {
        val state = RemoteTranscriptPresentation()
        val old = RemoteChatMessage("old", 1, role = 2, status = 2, text = "Earlier")
        val live = state.update(
            messages = listOf(old),
            generation = "generation",
            attempt = attempt("live", source),
            settled = null,
            visibleKeys = emptySet(),
            followTail = true,
        ).last()
        val delivery = RemoteChatMessage("delivery", 8, role = 2, status = 2, text = "Independent delivery")
        val overlap = state.update(
            messages = listOf(old, delivery, terminal),
            generation = "generation",
            attempt = attempt("live", source),
            settled = null,
            visibleKeys = setOf(live.key),
            followTail = false,
        )
        assertEquals(listOf("old", "delivery", "durable", live.key), overlap.map { it.key })
        val rows = state.update(
            messages = listOf(old, delivery, terminal),
            generation = "generation",
            attempt = null,
            settled = RemoteChatSettlement("live", terminal.seq),
            visibleKeys = setOf(live.key),
            followTail = false,
        )
        assertEquals(listOf("old", "delivery", live.key), rows.map { it.key })
        assertTrue(rows.last().deferFormatting)
        assertEquals(source, rows.last().text)
    }

    @Test fun `stopped and failed terminal bodies retain final increment and release full formatting`() {
        for (status in listOf(3, 4)) {
            val state = RemoteTranscriptPresentation()
            val id = "live-$status"
            val live = state.update(
                messages = emptyList(),
                generation = "generation",
                attempt = attempt(id, source.dropLast(8)),
                settled = null,
                visibleKeys = emptySet(),
                followTail = true,
            ).single()
            val settlement = RemoteChatSettlement(id, terminal.seq)
            val rows = state.update(
                messages = listOf(terminal.copy(status = status)),
                generation = "generation",
                attempt = null,
                settled = settlement,
                visibleKeys = setOf(live.key),
                followTail = false,
            )
            assertEquals(source, rows.single().text)
            assertNull(rows.single().documentToShow(parseMarkdown(source)))
            val released = state.update(
                messages = listOf(terminal.copy(status = status)),
                generation = "generation",
                attempt = null,
                settled = settlement,
                visibleKeys = setOf(live.key),
                followTail = true,
            ).single()
            assertEquals(source, released.documentToShow(parseMarkdown(source))!!.source)
        }
    }

    @Test fun `same text delivery and new live attempt are never identified by content`() {
        val state = RemoteTranscriptPresentation()
        val firstAttempt = attempt("first", "")
        val secondAttempt = attempt("second", "next")
        val first = state.update(
            messages = emptyList(),
            generation = "generation",
            attempt = firstAttempt,
            settled = null,
            visibleKeys = emptySet(),
            followTail = true,
        ).single().key
        val delivery = terminal.copy(messageId = "delivery", seq = 8)
        val live = state.update(
            messages = listOf(delivery),
            generation = "generation",
            attempt = firstAttempt,
            settled = null,
            visibleKeys = setOf(first),
            followTail = false,
        )
        assertEquals(listOf("delivery", first), live.map { it.key })
        val next = state.update(
            messages = listOf(delivery, terminal),
            generation = "generation",
            attempt = secondAttempt,
            settled = RemoteChatSettlement("first", terminal.seq),
            visibleKeys = setOf(first),
            followTail = false,
        )
        assertEquals(listOf("delivery", first, "attempt:generation:second"), next.map { it.key })
        assertTrue(next[1].deferFormatting)
        assertFalse(next[0].deferFormatting)
        val history = RemoteTranscriptPresentation().update(
            messages = listOf(delivery, terminal),
            generation = "generation",
            attempt = null,
            settled = RemoteChatSettlement("first", terminal.seq),
            visibleKeys = setOf("durable"),
            followTail = false,
        )
        assertEquals(listOf("delivery", "durable"), history.map { it.key })
        assertTrue(history.none { it.deferFormatting })
    }

}
