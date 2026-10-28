package me.rerere.rikkahub.ui.identity

import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import me.rerere.rikkahub.R
import me.rerere.rikkahub.data.remote.AccountSession
import me.rerere.rikkahub.data.remote.ImpressionBackend
import me.rerere.rikkahub.data.remote.ImpressionFailure
import me.rerere.rikkahub.data.remote.ImpressionState
import me.rerere.rikkahub.ui.fairy.FairyBackground
import me.rerere.rikkahub.ui.fairy.FairyPresence
import me.rerere.rikkahub.ui.fairy.FairyWindowBarHeight
import me.rerere.rikkahub.ui.fairy.FairyWindowState
import me.rerere.rikkahub.ui.fairy.FairyWindowTopBar
import org.koin.compose.koinInject

/**
 * The user's own impression, read-only.
 *
 * The page shows what the backend stores and offers no way to change it: the
 * client has no write path at all, so the impression changes only when the user
 * asks Fairy for it explicitly. Until a read actually succeeds
 * ([me.rerere.rikkahub.data.remote.ImpressionSnapshot.impression] is non-null)
 * there is nothing to show, and a failed read is reported with a retry.
 *
 * The body is plain text and is never clipped here.
 */
@Composable
fun ImpressionPage(
    onBack: () -> Unit,
    session: AccountSession = koinInject(),
    backend: ImpressionBackend = koinInject(),
) {
    val identity by session.identity.collectAsStateWithLifecycle()
    val token = identity?.token
    val scope = rememberCoroutineScope()
    val state = remember(backend, scope) { ImpressionState(backend, scope) }
    LaunchedEffect(token) {
        if (token != null) state.load(token)
    }
    val snapshot by state.snapshot.collectAsStateWithLifecycle()
    val read = snapshot.impression

    Box(Modifier.fillMaxSize()) {
        FairyBackground(watermark = false)
        Column(
            modifier = Modifier
                .fillMaxSize()
                .statusBarsPadding()
                .padding(top = FairyWindowBarHeight)
                .navigationBarsPadding()
                .padding(horizontal = 16.dp)
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.Top,
        ) {
            Text(
                text = stringResource(R.string.impression_explain),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            if (token == null) {
                Spacer(Modifier.height(16.dp))
                Text(
                    text = stringResource(R.string.impression_signed_out),
                    style = MaterialTheme.typography.bodyMedium,
                )
            }

            ImpressionFailureBanner(snapshot.failure)

            when {
                snapshot.loading && read == null -> {
                    Spacer(Modifier.height(16.dp))
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        CircularProgressIndicator()
                        Text(stringResource(R.string.impression_loading))
                    }
                }

                read == null -> {
                    if (token != null) {
                        Spacer(Modifier.height(16.dp))
                        Text(
                            text = stringResource(R.string.impression_read_failed),
                            style = MaterialTheme.typography.bodyMedium,
                        )
                        Spacer(Modifier.height(12.dp))
                        OutlinedButton(
                            onClick = { state.load(token) },
                            enabled = !snapshot.loading,
                            modifier = Modifier.fillMaxWidth().testTag("impression_retry"),
                        ) {
                            Text(stringResource(R.string.impression_retry))
                        }
                    }
                }

                else -> {
                    Spacer(Modifier.height(16.dp))
                    Text(
                        text = stringResource(R.string.impression_content_label),
                        style = MaterialTheme.typography.labelLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Spacer(Modifier.height(6.dp))
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .border(
                                width = 1.dp,
                                color = MaterialTheme.colorScheme.outlineVariant,
                                shape = RoundedCornerShape(6.dp),
                            )
                            .padding(12.dp)
                            .testTag("impression_content"),
                    ) {
                        if (read.content.isEmpty()) {
                            Text(
                                text = stringResource(R.string.impression_empty),
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        } else {
                            SelectionContainer {
                                Text(
                                    text = read.content,
                                    style = MaterialTheme.typography.bodyMedium,
                                )
                            }
                        }
                    }
                }
            }

            Spacer(Modifier.height(24.dp))
        }
        FairyWindowTopBar(
            window = FairyWindowState(FairyPresence.IDLE),
            subtitle = stringResource(R.string.impression_title),
            onNavigateBack = onBack,
        )
    }
}

/** The backend's own words, or the localized "unreachable" for a lost connection. */
@Composable
private fun ImpressionFailureBanner(failure: ImpressionFailure?) {
    if (failure == null) return
    Spacer(Modifier.height(12.dp))
    Text(
        text = if (failure.unreachable) {
            stringResource(R.string.impression_unreachable)
        } else {
            "${failure.code}: ${failure.message}"
        },
        color = MaterialTheme.colorScheme.error,
        style = MaterialTheme.typography.bodySmall,
    )
}
