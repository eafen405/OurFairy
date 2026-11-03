package me.rerere.rikkahub.ui.identity

import androidx.compose.foundation.background
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
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
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
import me.rerere.rikkahub.data.remote.ImpressionSnapshot
import me.rerere.rikkahub.data.remote.ImpressionState
import me.rerere.rikkahub.ui.fairy.FairyBackground
import me.rerere.rikkahub.ui.fairy.FairyPresence
import me.rerere.rikkahub.ui.fairy.FairyWindowBarHeight
import me.rerere.rikkahub.ui.fairy.FairyWindowState
import me.rerere.rikkahub.ui.fairy.FairyWindowTopBar

/**
 * The user's own impression: one multi-line plain-text field and a whole-body
 * save.
 *
 * The rule that shapes the page is read-before-edit. Until a read actually
 * succeeds ([ImpressionSnapshot.impression] is non-null) the field and the save
 * button are disabled and there is no draft to submit; the backend enforces the
 * same rule independently, so a hand-made request cannot skip it. There is no
 * memory browser here: this page edits only the impression, never a long-term
 * memory row.
 *
 * The draft is plain text and is never clipped. The counter shows the Unicode
 * character count against the backend's limit, and an over-limit save is
 * answered with the backend's own `impression/too-long` refusal, which the
 * failure banner shows verbatim.
 */
@Composable
fun ImpressionPage(
    onBack: () -> Unit,
    session: AccountSession,
    backend: ImpressionBackend,
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

    // A successful read starts (or replaces) the draft. Nothing here writes
    // before that: the field is not even enabled while `read` is null.
    var draft by remember { mutableStateOf("") }
    LaunchedEffect(read) {
        if (read != null) draft = read.content
    }

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
                    if (snapshot.working) {
                        Spacer(Modifier.height(12.dp))
                        Text(
                            text = stringResource(R.string.identity_working),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    Spacer(Modifier.height(16.dp))
                    OutlinedTextField(
                        value = draft,
                        onValueChange = { draft = it },
                        label = { Text(stringResource(R.string.impression_field_label)) },
                        supportingText = { Text(stringResource(R.string.impression_field_hint)) },
                        minLines = 8,
                        enabled = !snapshot.working,
                        modifier = Modifier.fillMaxWidth().testTag("impression_field"),
                    )
                    val characters = draft.codePointCount(0, draft.length)
                    val limit = read.maxCharacters
                    Text(
                        text = stringResource(R.string.impression_counter, characters, limit),
                        color = if (characters > limit) MaterialTheme.colorScheme.error
                        else MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.bodySmall,
                    )
                    Spacer(Modifier.height(12.dp))
                    Button(
                        onClick = { token?.let { state.save(it, draft) } },
                        enabled = !snapshot.working && token != null,
                        modifier = Modifier.fillMaxWidth().testTag("impression_save"),
                    ) {
                        Text(stringResource(R.string.impression_save))
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
