package me.rerere.rikkahub.ui.identity

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch
import kotlin.math.roundToInt
import androidx.compose.foundation.background
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.foundation.text.TextAutoSize
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.snapshotFlow
import me.rerere.rikkahub.ui.fairy.FairyAgedOverlay
import me.rerere.rikkahub.ui.fairy.FairyBackground
import me.rerere.rikkahub.ui.fairy.FairyColdStart
import me.rerere.rikkahub.ui.fairy.FairyCrtPowerOn
import me.rerere.rikkahub.ui.fairy.FairyHddBoot
import me.rerere.rikkahub.ui.fairy.FairyBootRail
import me.rerere.rikkahub.ui.fairy.InstrumentLevel
import me.rerere.rikkahub.ui.fairy.InstrumentPanel
import me.rerere.rikkahub.ui.fairy.SignalButton
import me.rerere.rikkahub.ui.fairy.SignalButtonVariant
import me.rerere.rikkahub.ui.fairy.LocalFairyTokens
import me.rerere.rikkahub.ui.fairy.rememberFairyPhase
import me.rerere.rikkahub.ui.fairy.fairySlant
import me.rerere.rikkahub.R
import me.rerere.rikkahub.data.remote.AccountSession
import me.rerere.rikkahub.data.remote.IdentityRefused
import me.rerere.rikkahub.data.remote.IdentityUnreachable
import org.koin.compose.koinInject

/**
 * The sign-in lockup: terminal kicker, the system name in the display face,
 * the boot rail and its percent readout. The home console keeps the H.D.D
 * plate, so the two screens do not share one wordmark.
 */
@Composable
private fun ProxyTerminalHeader(
    percent: Int,
    progress: () -> Float,
    phase: () -> Float,
    fault: Boolean,
) {
    val tokens = LocalFairyTokens.current
    Column(Modifier.fillMaxWidth()) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.width(5.dp).height(5.dp).background(tokens.signal))
            Spacer(Modifier.width(8.dp))
            Text(
                text = "H.D.D // PROXY TERMINAL",
                fontFamily = tokens.telemetryFontFamily,
                fontSize = 9.sp,
                letterSpacing = 1.2.sp,
                color = tokens.signal,
            )
            Spacer(Modifier.weight(1f))
            Text(
                text = "01",
                fontFamily = tokens.telemetryFontFamily,
                fontSize = 9.sp,
                letterSpacing = 1.sp,
                color = tokens.textMuted,
            )
        }
        Spacer(Modifier.height(12.dp))
        Text(
            text = "H.D.D.SYSTEM",
            fontFamily = tokens.titleFontFamily,
            fontWeight = FontWeight.Bold,
            fontSize = 38.sp,
            letterSpacing = 1.5.sp,
            textAlign = TextAlign.Center,
            color = tokens.textPrimary,
            maxLines = 1,
            // Narrow screens step the title down instead of wrapping it.
            autoSize = TextAutoSize.StepBased(
                minFontSize = 24.sp,
                maxFontSize = 38.sp,
                stepSize = 2.sp,
            ),
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(14.dp))
        FairyBootRail(progress = progress, phase = phase, fault = fault)
        Spacer(Modifier.height(7.dp))
        Text(
            text = "$percent%",
            fontFamily = tokens.telemetryFontFamily,
            fontSize = 20.sp,
            letterSpacing = 2.sp,
            textAlign = TextAlign.Center,
            color = if (fault) tokens.danger else tokens.signal,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

/** Sign in as an existing identity. */
@Composable
fun IdentitySignInPage(
    onSignedIn: () -> Unit,
    onRegister: () -> Unit,
    session: AccountSession = koinInject(),
) {
    var name by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var failure by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val unreachableText = stringResource(R.string.identity_unreachable)
    val tokens = LocalFairyTokens.current
    var booted by remember { mutableStateOf(false) }
    var powerOn by remember { mutableIntStateOf(if (FairyColdStart.claim()) 1 else 0) }
    // The boot rail follows the log's typed fraction, then holds at 99 %.
    val bootFraction = remember { mutableFloatStateOf(0f) }
    val rail = remember { Animatable(0f) }
    var railFault by remember { mutableStateOf(false) }
    var succeeded by remember { mutableStateOf(false) }
    // The sweep and the tube flicker belong to the boot; once the log folds
    // into the status lines the screen holds still and leaves compose idle.
    val phase = rememberFairyPhase(running = !booted)
    // The readout only recomposes when the whole percent changes, not per frame.
    var percent by remember { mutableIntStateOf(0) }
    LaunchedEffect(rail) {
        snapshotFlow { (rail.value * 100f).roundToInt().coerceIn(0, 100) }
            .distinctUntilChanged()
            .collect { percent = it }
    }

    LaunchedEffect(booted) {
        if (booted) {
            rail.animateTo(0.99f, tween(520, easing = FastOutSlowInEasing))
        } else {
            snapshotFlow { bootFraction.floatValue }.collect { typed ->
                rail.snapTo((typed * 0.90f).coerceIn(0f, 0.90f))
            }
        }
    }
    // One request, so the rail can only creep while it is in flight.
    LaunchedEffect(busy) {
        if (busy) rail.animateTo(0.994f, tween(900, easing = LinearEasing))
    }
    LaunchedEffect(failure) {
        if (failure != null) {
            railFault = true
            rail.animateTo(0.955f, tween(360, easing = FastOutSlowInEasing))
        }
    }
    LaunchedEffect(succeeded) {
        // Full is a hard step, not a glide: the console takes the last percent
        // the way a mechanical gauge does, then the tube collapses.
        if (succeeded) rail.snapTo(1f)
    }

    Box(
        Modifier
            .fillMaxSize()
            .background(Brush.verticalGradient(listOf(tokens.bgTop, tokens.bgBottom))),
    ) {
        FairyBackground()
        Column(
            modifier = Modifier
                .fillMaxSize()
                .statusBarsPadding()
                .navigationBarsPadding()
                .imePadding()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp, vertical = 24.dp),
            verticalArrangement = Arrangement.Top,
        ) {
            ProxyTerminalHeader(
                percent = percent,
                progress = { rail.value },
                phase = { phase.floatValue },
                fault = railFault,
            )
            Spacer(Modifier.height(16.dp))
            FairyHddBoot(
                onBooted = { booted = true },
                onProgress = { bootFraction.floatValue = it },
            )
            androidx.compose.animation.AnimatedVisibility(
                visible = booted,
                enter = fadeIn(tween(300)),
            ) {
            InstrumentPanel(modifier = Modifier.fillMaxWidth(), level = InstrumentLevel.RAISED) {
            Spacer(Modifier.height(4.dp))
            Text(
                text = stringResource(R.string.identity_sign_in_title),
                fontFamily = tokens.titleFontFamily,
                fontWeight = FontWeight.Black,
                fontSize = 20.sp,
                color = tokens.textPrimary,
            )
            Spacer(Modifier.height(4.dp))
            Text(
                text = stringResource(R.string.identity_sign_in_subtitle),
                style = MaterialTheme.typography.bodyMedium,
                color = tokens.textMuted,
            )
            Spacer(Modifier.height(16.dp))

            OutlinedTextField(
                value = name,
                onValueChange = { name = it },
                label = { Text(stringResource(R.string.identity_name_label)) },
                singleLine = true,
                enabled = !busy,
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(
                value = password,
                onValueChange = { password = it },
                label = { Text(stringResource(R.string.identity_password_label)) },
                singleLine = true,
                enabled = !busy,
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(
                    keyboardType = KeyboardType.Password,
                    imeAction = ImeAction.Done,
                ),
                modifier = Modifier.fillMaxWidth(),
            )

            failure?.let { message ->
                Spacer(Modifier.height(12.dp))
                Text(
                    text = message,
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodySmall,
                )
            }

            Spacer(Modifier.height(20.dp))
            SignalButton(
                text = if (busy) stringResource(R.string.identity_signing_in) else stringResource(R.string.identity_sign_in_action),
                tag = "LINK",
                variant = SignalButtonVariant.PRIMARY,
                onClick = {
                    if (busy || name.isBlank()) return@SignalButton
                    busy = true
                    failure = null
                    railFault = false
                    scope.launch {
                        try {
                            session.signIn(name.trim(), password)
                            succeeded = true
                            onSignedIn()
                        } catch (refused: IdentityRefused) {
                            failure = refused.message ?: refused.code
                        } catch (unreachable: IdentityUnreachable) {
                            failure = unreachableText
                        } finally {
                            busy = false
                        }
                    }
                },
                enabled = !busy && name.isNotBlank(),
                modifier = Modifier.fillMaxWidth(),
            )

            Spacer(Modifier.height(8.dp))
            SignalButton(
                text = stringResource(R.string.identity_have_invite),
                onClick = onRegister,
                enabled = !busy,
                modifier = Modifier.fillMaxWidth(),
            )
            }
            }
        }
        FairyAgedOverlay(Modifier.fillMaxSize(), phase = { phase.floatValue })
        FairyCrtPowerOn(powerOn)
    }
}

/** Redeem an invite and become a new identity. */
@Composable
fun IdentityRegisterPage(
    onRegistered: () -> Unit,
    onBackToSignIn: () -> Unit,
    session: AccountSession = koinInject(),
) {
    var code by remember { mutableStateOf("") }
    var name by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var failure by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val unreachableText = stringResource(R.string.identity_unreachable)
    val tokens = LocalFairyTokens.current
    var powerOn by remember { mutableIntStateOf(if (FairyColdStart.claim()) 1 else 0) }

    Box(
        Modifier
            .fillMaxSize()
            .background(Brush.verticalGradient(listOf(tokens.bgTop, tokens.bgBottom))),
    ) {
        FairyBackground()
        Column(
            modifier = Modifier
                .fillMaxSize()
                .statusBarsPadding()
                .navigationBarsPadding()
                .imePadding()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp, vertical = 24.dp),
            verticalArrangement = Arrangement.Top,
        ) {
            Text(
                text = "INVITE REDEMPTION",
                fontFamily = tokens.telemetryFontFamily,
                fontSize = 10.sp,
                letterSpacing = 2.sp,
                color = tokens.fairyLink.copy(alpha = 0.7f),
                modifier = Modifier.fairySlant(),
            )
            Spacer(Modifier.height(8.dp))
            Text(
                text = stringResource(R.string.identity_register_title),
                fontFamily = tokens.titleFontFamily,
                fontWeight = FontWeight.Black,
                fontSize = 22.sp,
                color = tokens.textPrimary,
            )
            Spacer(Modifier.height(4.dp))
            Text(
                text = stringResource(R.string.identity_register_subtitle),
                style = MaterialTheme.typography.bodyMedium,
                color = tokens.textMuted,
            )
            Spacer(Modifier.height(20.dp))

            OutlinedTextField(
                value = code,
                onValueChange = { code = it },
                label = { Text(stringResource(R.string.identity_invite_code_label)) },
                singleLine = true,
                enabled = !busy,
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(
                value = name,
                onValueChange = { name = it },
                label = { Text(stringResource(R.string.identity_name_label)) },
                singleLine = true,
                enabled = !busy,
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(
                value = password,
                onValueChange = { password = it },
                label = { Text(stringResource(R.string.identity_password_label)) },
                singleLine = true,
                enabled = !busy,
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(
                    keyboardType = KeyboardType.Password,
                    imeAction = ImeAction.Done,
                ),
                modifier = Modifier.fillMaxWidth(),
            )

            failure?.let { message ->
                Spacer(Modifier.height(12.dp))
                Text(
                    text = message,
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodySmall,
                )
            }

            Spacer(Modifier.height(20.dp))
            SignalButton(
                text = if (busy) "正在注册…" else stringResource(R.string.identity_register_action),
                tag = "REGISTER",
                variant = SignalButtonVariant.PRIMARY,
                onClick = {
                    if (busy || code.isBlank() || name.isBlank()) return@SignalButton
                    busy = true
                    failure = null
                    scope.launch {
                        try {
                            session.register(code.trim(), name.trim(), password)
                            onRegistered()
                        } catch (refused: IdentityRefused) {
                            failure = refused.message ?: refused.code
                        } catch (unreachable: IdentityUnreachable) {
                            failure = unreachableText
                        } finally {
                            busy = false
                        }
                    }
                },
                enabled = !busy && code.isNotBlank() && name.isNotBlank(),
                modifier = Modifier.fillMaxWidth(),
            )

            Spacer(Modifier.height(8.dp))
            SignalButton(
                text = stringResource(R.string.identity_back_to_sign_in),
                onClick = onBackToSignIn,
                enabled = !busy,
                modifier = Modifier.fillMaxWidth(),
            )
        }
        FairyCrtPowerOn(powerOn)
    }
}

@Composable
fun IdentityNotReadyPage(
    identity: IdentityScope,
    onSignIn: () -> Unit,
) {
    Scaffold { innerPadding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .padding(24.dp),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(
                text = stringResource(R.string.identity_not_ready_title),
                style = MaterialTheme.typography.headlineSmall,
            )
            Spacer(Modifier.height(8.dp))
            Text(
                text = stringResource(R.string.identity_not_ready_body),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (!identity.signedIn) {
                Spacer(Modifier.height(4.dp))
                Text(
                    text = stringResource(R.string.identity_not_ready_signed_out),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(16.dp))
                Button(onClick = onSignIn) {
                    Text(stringResource(R.string.identity_sign_in_action))
                }
            }
        }
    }
}
