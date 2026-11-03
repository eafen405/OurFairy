package me.rerere.rikkahub.ui.fairy

import android.app.Application
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import me.rerere.rikkahub.data.datastore.DisplayPreferences
import me.rerere.rikkahub.data.datastore.LocalDisplayPreferences
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * The reusable numeric control's own presentation: the unit and range are
 * visible, and a busy write disables both the slider and the direct input so a
 * second value cannot race the first.
 */
@RunWith(RobolectricTestRunner::class)
@Config(application = Application::class, sdk = [35], qualifiers = "zh-rCN-w411dp-h891dp")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class FairyNumericFieldTest {
    @get:Rule val compose = createComposeRule()

    private val spec = FairyNumericSpec(
        label = "自动压缩触发阈值",
        unit = "K token",
        min = 100,
        max = 900,
        scale = 1000,
    )

    private fun show(busy: Boolean) {
        compose.setContent {
            CompositionLocalProvider(LocalDisplayPreferences provides DisplayPreferences()) {
                FairyAppTheme {
                    ProvideAgoraMotionPolicy(appReduceMotion = true) {
                        FairyNumericField(
                            state = rememberFairyNumericDraftState(spec, 500_000),
                            busy = busy,
                            tagPrefix = "numeric",
                        )
                    }
                }
            }
        }
        compose.waitForIdle()
    }

    @Test
    fun `a busy write disables the slider and the direct input`() {
        show(busy = true)

        compose.onNodeWithTag("numeric_input").assertIsNotEnabled()
        compose.onNodeWithTag("numeric_slider").assertIsNotEnabled()
    }

    @Test
    fun `an idle control shows the draft, unit and range and stays editable`() {
        show(busy = false)

        compose.onNodeWithTag("numeric_input").assertIsEnabled()
        compose.onNodeWithTag("numeric_slider").assertIsEnabled()
        compose.onNodeWithText("范围：100–900 K token").assertIsDisplayed()
    }
}
