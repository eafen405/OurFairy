package me.rerere.rikkahub.ui.identity

import android.app.Application
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import me.rerere.rikkahub.data.datastore.DisplayPreferences
import me.rerere.rikkahub.data.datastore.LocalDisplayPreferences
import me.rerere.rikkahub.data.remote.RemoteChatAttempt
import me.rerere.rikkahub.data.remote.RemoteChatMessage
import me.rerere.rikkahub.data.remote.RemoteChatSettlement
import me.rerere.rikkahub.ui.fairy.FairyAppTheme
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(application = Application::class, sdk = [35], qualifiers = "zh-rCN-w411dp-h891dp")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class RemoteStreamingPacingTest {
    @get:Rule val compose = createComposeRule()
    private var live by mutableStateOf<String?>(null)
    private var messages by mutableStateOf<List<RemoteChatMessage>>(emptyList())
    private var settlement by mutableStateOf<RemoteChatSettlement?>(null)

    private fun show() {
        compose.mainClock.autoAdvance = false
        compose.setContent {
            CompositionLocalProvider(LocalDisplayPreferences provides DisplayPreferences()) {
                FairyAppTheme {
                    RemoteTranscript(
                        messages = messages,
                        generation = "g",
                        attempt = live?.let { RemoteChatAttempt(attemptId = "a", revision = 0, text = it) },
                        downloadEnabled = false,
                        onDownload = { _, _ -> },
                        settledAttempt = settlement,
                        modifier = Modifier.fillMaxSize(),
                    )
                }
            }
        }
    }

    @Test fun `large live increments are revealed progressively before the latest text completes`() {
        val body = "流".repeat(80)
        live = body
        show()

        compose.mainClock.advanceTimeBy(100)
        compose.onNodeWithText(body).assertDoesNotExist()
        compose.onNodeWithText(body.take(4), substring = true).assertExists()

        compose.mainClock.advanceTimeBy(2_000)
        compose.onNodeWithText(body).assertExists()
    }

    @Test fun `settled reply publishes the complete body without waiting for paced reveal`() {
        val body = "流".repeat(80)
        live = body
        show()

        compose.mainClock.advanceTimeBy(100)
        compose.onNodeWithText(body).assertDoesNotExist()
        compose.runOnIdle {
            messages = listOf(RemoteChatMessage("m", 0, 9, role = 2, status = 2, text = body))
            settlement = RemoteChatSettlement("a", 9)
            live = null
        }

        compose.mainClock.advanceTimeBy(32)
        compose.onNodeWithText(body).assertExists()
    }
}
