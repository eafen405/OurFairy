package me.rerere.rikkahub.ui.identity

import me.rerere.rikkahub.data.remote.*
import me.rerere.ui.markdown.*
import org.junit.Assert.*
import org.junit.Test

class RemoteReadingTransitionTest {
    private val source = "Reading [the ending][ref].\n\n```kotlin\nval final = 42\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n\$\$x^2\$\$\n\n[ref]: https://example.com/end"
    private val terminal = RemoteChatMessage("durable", 2, 9, role = 2, status = 3, text = source)

    private fun attempt(id: String, text: String) =
        RemoteChatAttempt(attemptId = id, revision = 0, text = text)

    /**
     * Backend facts in, visual rows out. Callers pass generation, a backend attempt and a
     * backend settlement, never a row key; identity is observed through the returned
     * [RemoteTranscriptRow.key]. The one literal `attempt:<generation>:<attemptId>` assertion
     * below is the deliberate format check (Testing Decision 5); every other scenario compares
     * keys captured from earlier public results.
     */
    private fun RemoteTranscriptPresentation.present(
        messages: List<RemoteChatMessage> = emptyList(),
        generation: String = "generation",
        attempt: RemoteChatAttempt? = null,
        settlement: RemoteChatSettlement? = null,
        visible: Set<String> = emptySet(),
        followTail: Boolean = true,
    ): List<RemoteTranscriptRow> =
        update(messages, generation, attempt, settlement, visible, followTail)

    @Test fun `attempt row key format is generation scoped and settlement keeps the observed live key`() {
        val state = RemoteTranscriptPresentation()
        val live = state.present(generation = "gen-7", attempt = attempt("attempt-2", "streaming")).single()
        assertEquals("attempt:gen-7:attempt-2", live.key)

        val settled = state.present(
            messages = listOf(terminal),
            generation = "gen-7",
            settlement = RemoteChatSettlement("attempt-2", terminal.seq),
            visible = setOf(live.key),
            followTail = false,
        ).single()
        assertEquals(live.key, settled.key)
    }

    @Test fun `reader keeps same raw layout through terminal and gets parsed complete body after leaving`() {
        val state = RemoteTranscriptPresentation()
        val live = state.present(attempt = attempt("live", source)).single()
        val settlement = RemoteChatSettlement("live", terminal.seq)
        val settled = state.present(
            messages = listOf(terminal),
            settlement = settlement,
            visible = setOf(live.key),
            followTail = false,
        ).single()
        assertEquals(live.key, settled.key)
        assertEquals(live.text, settled.text)
        assertTrue(settled.deferFormatting)
        val parsed = parseMarkdown(settled.text)
        assertNull(settled.documentToShow(parsed))
        val released = state.present(
            messages = listOf(terminal),
            settlement = settlement,
            visible = emptySet(),
            followTail = false,
        ).single()
        assertSame(parsed, released.documentToShow(parsed))
        assertTrue(parsed.blocks.any { it is MarkdownBlock.CodeBlock })
        assertTrue(parsed.blocks.any { it is MarkdownBlock.Table })
        assertTrue(parsed.blocks.filterIsInstance<MarkdownBlock.Paragraph>().any { it.content.any { node -> node is MarkdownInline.Math && node.display } })
        assertEquals(1, state.present(
            messages = listOf(terminal),
            settlement = RemoteChatSettlement("unrelated", terminal.seq),
            visible = emptySet(),
            followTail = false,
        ).size)
    }

    @Test fun `return to tail releases pending formatting while history never waits for scrolling`() {
        val state = RemoteTranscriptPresentation()
        val live = state.present(attempt = attempt("live", source)).single()
        val settlement = RemoteChatSettlement("live", terminal.seq)
        assertTrue(state.present(
            messages = listOf(terminal),
            settlement = settlement,
            visible = setOf(live.key),
            followTail = false,
        ).single().deferFormatting)
        val resumed = state.present(
            messages = listOf(terminal),
            settlement = settlement,
            visible = setOf(live.key),
            followTail = true,
        ).single()
        assertFalse(resumed.deferFormatting)
        assertFalse(state.present(
            messages = listOf(terminal),
            settlement = settlement,
            visible = setOf(live.key),
            followTail = false,
        ).single().deferFormatting)
        val history = RemoteTranscriptPresentation().present(
            messages = listOf(terminal),
            visible = setOf("durable"),
            followTail = false,
        ).single()
        assertFalse(history.deferFormatting)
        assertEquals("durable", history.key)
    }

    @Test fun `formal reply before stream end and unrelated delivery retain exactly one settled reading row`() {
        val state = RemoteTranscriptPresentation()
        val old = RemoteChatMessage("old", 0, 1, role = 2, status = 2, text = "Earlier")
        val live = state.present(
            messages = listOf(old),
            attempt = attempt("live", source),
        ).last()
        val delivery = RemoteChatMessage("delivery", 1, 8, role = 2, status = 2, text = "Independent delivery")
        val overlap = state.present(
            messages = listOf(old, delivery, terminal),
            attempt = attempt("live", source),
            visible = setOf(live.key),
            followTail = false,
        )
        assertEquals(listOf("old", "delivery", "durable", live.key), overlap.map { it.key })
        val rows = state.present(
            messages = listOf(old, delivery, terminal),
            settlement = RemoteChatSettlement("live", terminal.seq),
            visible = setOf(live.key),
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
            val live = state.present(
                attempt = attempt(id, source.dropLast(8)),
            ).single()
            val settlement = RemoteChatSettlement(id, terminal.seq)
            val rows = state.present(
                messages = listOf(terminal.copy(status = status)),
                settlement = settlement,
                visible = setOf(live.key),
                followTail = false,
            )
            assertEquals(source, rows.single().text)
            assertNull(rows.single().documentToShow(parseMarkdown(source)))
            val released = state.present(
                messages = listOf(terminal.copy(status = status)),
                settlement = settlement,
                visible = setOf(live.key),
                followTail = true,
            ).single()
            assertEquals(source, released.documentToShow(parseMarkdown(source))!!.source)
        }
    }

    @Test fun `same text delivery and new live attempt are never identified by content`() {
        val state = RemoteTranscriptPresentation()
        val firstAttempt = attempt("first", "")
        val secondAttempt = attempt("second", "next")
        val first = state.present(attempt = firstAttempt).single().key
        val delivery = terminal.copy(messageId = "delivery", seq = 8, position = 0)
        val live = state.present(
            messages = listOf(delivery),
            attempt = firstAttempt,
            visible = setOf(first),
            followTail = false,
        )
        assertEquals(listOf("delivery", first), live.map { it.key })
        val next = state.present(
            messages = listOf(delivery, terminal),
            attempt = secondAttempt,
            settlement = RemoteChatSettlement("first", terminal.seq),
            visible = setOf(first),
            followTail = false,
        )
        assertEquals(3, next.size)
        assertEquals("delivery", next[0].key)
        assertFalse(next[0].deferFormatting)
        assertEquals(first, next[1].key)
        assertEquals(source, next[1].text)
        assertTrue(next[1].deferFormatting)
        assertEquals("next", next[2].text)
        assertNotEquals(first, next[2].key)
        assertNotEquals(next[1].key, next[2].key)
        val history = RemoteTranscriptPresentation().present(
            messages = listOf(delivery, terminal),
            settlement = RemoteChatSettlement("first", terminal.seq),
            visible = setOf("durable"),
            followTail = false,
        )
        assertEquals(listOf("delivery", "durable"), history.map { it.key })
        assertTrue(history.none { it.deferFormatting })
    }

    @Test fun `settlement from another generation neither inherits the observed row nor defers`() {
        val state = RemoteTranscriptPresentation()
        val live = state.present(attempt = attempt("live", source)).single()
        val rows = state.present(
            messages = listOf(terminal),
            generation = "other-generation",
            settlement = RemoteChatSettlement("live", terminal.seq),
            visible = setOf(live.key),
            followTail = false,
        )
        assertEquals(listOf("durable"), rows.map { it.key })
        assertFalse(rows.single().deferFormatting)
    }

    @Test fun `unrelated settlement neither maps nor defers and a later exact settlement still works`() {
        val state = RemoteTranscriptPresentation()
        val live = state.present(attempt = attempt("live", source)).single()
        val unrelated = state.present(
            messages = listOf(terminal),
            settlement = RemoteChatSettlement("other", terminal.seq),
            visible = setOf(live.key),
            followTail = false,
        ).single()
        assertEquals("durable", unrelated.key)
        assertFalse(unrelated.deferFormatting)

        val settled = state.present(
            messages = listOf(terminal),
            settlement = RemoteChatSettlement("live", terminal.seq),
            visible = setOf(live.key),
            followTail = false,
        ).single()
        assertEquals(live.key, settled.key)
        assertTrue(settled.deferFormatting)
    }

    @Test fun `settlement for a live attempt never observed neither maps nor defers`() {
        val rows = RemoteTranscriptPresentation().present(
            messages = listOf(terminal),
            settlement = RemoteChatSettlement("never-observed", terminal.seq),
            visible = setOf("durable"),
            followTail = false,
        )
        assertEquals(listOf("durable"), rows.map { it.key })
        assertFalse(rows.single().deferFormatting)
    }

    @Test fun `settlement only maps a unique Fairy message with the exact seq and a later exact settlement still works`() {
        val state = RemoteTranscriptPresentation()
        val live = state.present(attempt = attempt("live", source)).single()
        val mismatches = listOf(
            listOf(terminal.copy(seq = terminal.seq + 1)),
            listOf(RemoteChatMessage("user-same-seq", terminal.position, terminal.seq, role = 1, status = 2, text = source)),
            listOf(terminal, terminal.copy(messageId = "duplicate-fairy")),
        )
        for (messages in mismatches) {
            val rows = state.present(
                messages = messages,
                settlement = RemoteChatSettlement("live", terminal.seq),
                visible = setOf(live.key),
                followTail = false,
            )
            assertEquals(messages.map { it.messageId }, rows.map { it.key })
            assertTrue(rows.none { it.deferFormatting })
        }
        val settled = state.present(
            messages = listOf(terminal),
            settlement = RemoteChatSettlement("live", terminal.seq),
            visible = setOf(live.key),
            followTail = false,
        ).single()
        assertEquals(live.key, settled.key)
        assertTrue(settled.deferFormatting)
    }

    @Test fun `settlement for the previous attempt does not map after a new attempt is current`() {
        val state = RemoteTranscriptPresentation()
        val first = state.present(attempt = attempt("first", source)).single()
        val second = state.present(
            messages = listOf(terminal),
            attempt = attempt("second", "next"),
        ).last()
        assertEquals("next", second.text)
        assertNotEquals(first.key, second.key)

        val rows = state.present(
            messages = listOf(terminal),
            attempt = attempt("second", "next"),
            settlement = RemoteChatSettlement("first", terminal.seq),
            visible = setOf(first.key),
            followTail = false,
        )
        assertEquals(listOf("durable", second.key), rows.map { it.key })
        assertTrue(rows.none { it.deferFormatting })

        val secondTerminal = RemoteChatMessage("second-durable", 3, 10, role = 2, status = 2, text = "Second answer")
        val settled = state.present(
            messages = listOf(terminal, secondTerminal),
            settlement = RemoteChatSettlement("second", secondTerminal.seq),
            visible = setOf(second.key),
            followTail = false,
        ).single { it.key == second.key }
        assertTrue(settled.deferFormatting)
    }
}
