package me.rerere.rikkahub.ui.fairy

import android.app.Application
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onParent
import androidx.compose.ui.test.performClick
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(application = Application::class, sdk = [35])
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class FairyInstrumentTest {
    @get:Rule val compose = createComposeRule()

    @Test fun `instrument panel exposes its content`() {
        compose.setContent {
            FairyAppTheme {
                InstrumentPanel(level = InstrumentLevel.RECESSED, chamfered = true) {
                    Text("SESSION 01")
                }
            }
        }

        compose.onNodeWithText("SESSION 01").assertIsDisplayed()
    }

    @Test fun `signal button preserves click and disabled behavior`() {
        var clicks = 0
        var enabled by mutableStateOf(true)
        compose.setContent {
            FairyAppTheme {
                SignalButton(
                    text = "进入会话",
                    tag = "SESSIONS",
                    variant = SignalButtonVariant.PRIMARY,
                    enabled = enabled,
                    onClick = { clicks++ },
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }

        compose.onNodeWithText("进入会话").performClick()
        compose.runOnIdle {
            assertEquals(1, clicks)
            enabled = false
        }
        compose.onNodeWithText("进入会话").assertIsNotEnabled()
        compose.onNodeWithText("SESSIONS").assertIsDisplayed()
    }

    @Test fun `only live status announces updates`() {
        compose.setContent {
            FairyAppTheme {
                StatusChip("STANDBY")
                StatusChip("ANALYZING", tone = StatusTone.SIGNAL, live = true)
            }
        }

        compose.onNodeWithText("STANDBY").onParent().assert(SemanticsMatcher.keyNotDefined(SemanticsProperties.LiveRegion))
        compose.onNodeWithText("ANALYZING").onParent().assert(SemanticsMatcher.keyIsDefined(SemanticsProperties.LiveRegion))
    }
}
