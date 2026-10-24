package me.rerere.rikkahub.ui.fairy

import android.os.SystemClock
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.compose.currentStateAsState
import kotlinx.coroutines.delay
import me.rerere.rikkahub.Screen
import me.rerere.rikkahub.data.remote.RemoteReceiveState
import org.koin.compose.koinInject

private const val FIRST_LINE_MS = 45_000L
private const val NEXT_LINE_MIN_MS = 60_000L
private const val NEXT_LINE_MAX_MS = 90_000L
private const val SLEEP_AT_MS = 180_000L
private const val TICK_MS = 500L

/**
 * The console owns Fairy's live behaviour and real account/session state.
 * The throwaway visual variants live in FairyConsolePrototype.kt.
 */
@Composable
fun FairyConsolePage(
    onOpen: (Screen) -> Unit,
    session: me.rerere.rikkahub.data.remote.AccountSession = koinInject(),
    receive: RemoteReceiveState = koinInject(),
) {
    val baseTokens = LocalFairyTokens.current
    val context = LocalContext.current
    val memory = remember { FairyUiMemory(context) }
    val eye = remember { FairyEyeController() }
    val identity by session.identity.collectAsStateWithLifecycle()
    val owned by receive.owned.snapshot.collectAsStateWithLifecycle()
    var caption by remember { mutableStateOf<FairyLine?>(null) }
    var asleep by remember { mutableStateOf(false) }
    var lastTouch by remember { mutableLongStateOf(SystemClock.uptimeMillis()) }
    var nextLineAt by remember { mutableLongStateOf(FIRST_LINE_MS) }
    var powerOn by remember { mutableIntStateOf(if (FairyColdStart.claim()) 1 else 0) }
    val lifecycle by LocalLifecycleOwner.current.lifecycle.currentStateAsState()
    val speaks = LocalConfiguration.current.locales[0].language == "zh"
    val running = lifecycle.isAtLeast(Lifecycle.State.STARTED)
    // Prototype only: quiet the home page without changing any other Fairy surface.
    val tokens = remember(baseTokens) {
        baseTokens.copy(
            bgTop = Color(0xFF0C111C),
            bgBottom = Color(0xFF05070C),
            scanline = Color.White.copy(alpha = 0.009f),
        )
    }

    LaunchedEffect(running, speaks, asleep) {
        if (!running || !speaks || asleep) {
            caption = null
            return@LaunchedEffect
        }
        while (true) {
            delay(TICK_MS)
            val idle = SystemClock.uptimeMillis() - lastTouch
            when {
                idle >= SLEEP_AT_MS && caption == null -> {
                    asleep = true
                    eye.asleep = true
                    caption = memory.nextLine(FairyLines.sleepPool, 0)
                    return@LaunchedEffect
                }

                idle >= nextLineAt && caption == null -> {
                    caption = memory.nextLine(FairyLines.homePool, FairyLines.HOME_AVOID)
                    nextLineAt = idle + NEXT_LINE_MIN_MS + (0L..(NEXT_LINE_MAX_MS - NEXT_LINE_MIN_MS)).random()
                }
            }
        }
    }
    val origin = remember { floatArrayOf(0f, 0f) }
    CompositionLocalProvider(LocalFairyTokens provides tokens) {
        Box(
            Modifier
                .fillMaxSize()
                .background(Brush.verticalGradient(listOf(tokens.bgTop, tokens.bgBottom))),
        ) {
            FairyBackground(watermark = false)
            FairyConsolePrototype(
                user = identity?.user,
                sessions = owned,
                eye = eye,
                asleep = asleep,
                caption = caption,
                onCaptionFinished = { caption = null },
                onOpen = onOpen,
                modifier = Modifier
                    .fillMaxSize()
                    .onGloballyPositioned {
                        origin[0] = it.positionInRoot().x
                        origin[1] = it.positionInRoot().y
                    }
                    .pointerInput(eye) {
                        awaitPointerEventScope {
                            while (true) {
                                val event = awaitPointerEvent(PointerEventPass.Final)
                                val touch = event.changes.firstOrNull { it.pressed }
                                eye.lookAt(touch?.let { Offset(origin[0] + it.position.x, origin[1] + it.position.y) })
                                if (touch != null) {
                                    lastTouch = SystemClock.uptimeMillis()
                                    nextLineAt = FIRST_LINE_MS
                                    if (asleep) {
                                        asleep = false
                                        eye.wake(confused = true)
                                    }
                                }
                            }
                        }
                    },
            )
            FairyCrtPowerOn(powerOn)
        }
    }
}

/** Shared with settings; the console prototypes use quieter local actions. */
@Composable
fun SlantKey(
    text: String,
    tag: String,
    primary: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val tokens = LocalFairyTokens.current
    val shape = FairySlantShape(slant = 12.dp, corner = 8.dp)
    val interaction = remember { MutableInteractionSource() }
    val label = if (primary) tokens.onPrimary else tokens.textPrimary
    Box(
        modifier
            .fairyKey(shape, primary)
            .clickable(interaction, indication = null, onClick = onClick)
            .padding(horizontal = 20.dp),
        contentAlignment = Alignment.Center,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(
                text = text,
                fontFamily = tokens.titleFontFamily,
                fontWeight = FontWeight.Black,
                fontSize = 16.sp,
                color = label,
            )
            Text(
                text = tag,
                fontFamily = tokens.labelFontFamily,
                fontSize = 9.sp,
                letterSpacing = 1.2.sp,
                color = label.copy(alpha = 0.6f),
                modifier = Modifier.fairySlant(),
            )
        }
    }
}
