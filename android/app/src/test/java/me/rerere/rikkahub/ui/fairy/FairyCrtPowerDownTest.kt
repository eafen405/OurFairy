package me.rerere.rikkahub.ui.fairy

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.junit4.createComposeRule
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import android.app.Application

@RunWith(RobolectricTestRunner::class)
@Config(application = Application::class, sdk = [35], qualifiers = "w411dp-h891dp")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class FairyCrtPowerDownTest {
    @get:Rule val compose = createComposeRule()

    @Test fun `reduced motion collapses without animating`() {
        var collapsed = false
        compose.setContent {
            FairyAppTheme {
                ProvideAgoraMotionPolicy(appReduceMotion = true) {
                    FairyCrtPowerDown(active = true, onCollapsed = { collapsed = true }) {
                        Box(Modifier.fillMaxSize())
                    }
                }
            }
        }
        compose.waitForIdle()
        assertTrue(collapsed)
    }

    @Test fun `collapse waits for the crt run`() {
        var collapsed = false
        compose.mainClock.autoAdvance = false
        compose.setContent {
            FairyAppTheme {
                ProvideAgoraMotionPolicy(appReduceMotion = false) {
                    FairyCrtPowerDown(active = true, onCollapsed = { collapsed = true }) {
                        Box(Modifier.fillMaxSize())
                    }
                }
            }
        }
        // The collapse is 380 ms; the host must not navigate before it ends.
        compose.mainClock.advanceTimeBy(200)
        assertFalse(collapsed)
        compose.mainClock.advanceTimeBy(300)
        assertTrue(collapsed)
    }
}
