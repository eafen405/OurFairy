package me.rerere.rikkahub.ui.identity

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Switch
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
import me.rerere.rikkahub.data.remote.PendingSkill
import me.rerere.rikkahub.data.remote.SkillActionTarget
import me.rerere.rikkahub.data.remote.SkillPoolItem
import me.rerere.rikkahub.data.remote.SkillPoolState
import me.rerere.rikkahub.data.remote.SkillScope
import me.rerere.rikkahub.data.remote.SkillsBackend
import me.rerere.rikkahub.data.remote.SkillsFailure
import me.rerere.rikkahub.data.remote.SkillsSnapshot
import me.rerere.rikkahub.data.remote.SkillsState
import me.rerere.rikkahub.ui.fairy.FairyBackground
import me.rerere.rikkahub.ui.fairy.FairyPresence
import me.rerere.rikkahub.ui.fairy.FairyWindowBarHeight
import me.rerere.rikkahub.ui.fairy.FairyWindowState
import me.rerere.rikkahub.ui.fairy.FairyWindowTopBar

/**
 * The user's skill selection pool.
 *
 * The page renders only facts `/skills/list` derives: scope, the pool state (in catalog,
 * shadowed, disabled, archived), the effective switch value, the same-name shadower and the
 * numeric scope of each action. It never computes a winner or an archive itself. The switch is
 * the one action this ticket performs; archive and restore scopes are shown but not acted on
 * until their ticket, and the pending section has its callback seam ready for the review ticket.
 */
@Composable
fun SkillsPage(
    onBack: () -> Unit,
    session: AccountSession,
    backend: SkillsBackend,
    onOpenPending: (Long) -> Unit = {},
) {
    val identity by session.identity.collectAsStateWithLifecycle()
    val token = identity?.token
    val scope = rememberCoroutineScope()
    val state = remember(backend, scope) { SkillsState(backend, scope) }
    LaunchedEffect(token) {
        if (token != null) state.load(token)
    }
    val snapshot by state.snapshot.collectAsStateWithLifecycle()

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
                text = stringResource(R.string.skills_explain),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            if (token == null) {
                Spacer(Modifier.height(16.dp))
                Text(
                    text = stringResource(R.string.skills_signed_out),
                    style = MaterialTheme.typography.bodyMedium,
                )
            }

            SkillsFailureBanner(snapshot.failure)

            when {
                snapshot.loading && !snapshot.loaded -> {
                    Spacer(Modifier.height(16.dp))
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        CircularProgressIndicator()
                        Text(stringResource(R.string.skills_loading))
                    }
                }

                !snapshot.loaded -> {
                    if (token != null) {
                        Spacer(Modifier.height(16.dp))
                        Text(
                            text = stringResource(R.string.skills_read_failed),
                            style = MaterialTheme.typography.bodyMedium,
                        )
                        Spacer(Modifier.height(12.dp))
                        OutlinedButton(
                            onClick = { state.load(token) },
                            enabled = !snapshot.loading,
                            modifier = Modifier.fillMaxWidth().testTag("skills_retry"),
                        ) {
                            Text(stringResource(R.string.skills_retry))
                        }
                    }
                }

                else -> {
                    SkillSectionTitle(stringResource(R.string.skills_section_pool))
                    if (snapshot.skills.isEmpty()) {
                        Text(
                            text = stringResource(R.string.skills_empty),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    snapshot.skills.forEachIndexed { index, item ->
                        if (index > 0) HorizontalDivider(Modifier.padding(vertical = 4.dp))
                        SkillRow(
                            item = item,
                            enabled = !snapshot.working && token != null,
                            onToggle = { checked -> token?.let { state.setEnabled(it, item.skillId, checked) } },
                        )
                    }

                    Spacer(Modifier.height(24.dp))
                    SkillSectionTitle(stringResource(R.string.skills_section_pending))
                    if (snapshot.pending.isEmpty()) {
                        Text(
                            text = stringResource(R.string.skills_pending_empty),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    } else {
                        snapshot.pending.forEach { candidate ->
                            PendingSkillRow(candidate, onOpenPending)
                        }
                    }
                }
            }

            Spacer(Modifier.height(24.dp))
        }
        FairyWindowTopBar(
            window = FairyWindowState(FairyPresence.IDLE),
            subtitle = stringResource(R.string.skills_title),
            onNavigateBack = onBack,
        )
    }
}

@Composable
private fun SkillSectionTitle(text: String) {
    Spacer(Modifier.height(20.dp))
    Text(
        text = text,
        style = MaterialTheme.typography.titleSmall,
    )
    Spacer(Modifier.height(4.dp))
}

@Composable
private fun SkillRow(item: SkillPoolItem, enabled: Boolean, onToggle: (Boolean) -> Unit) {
    Column(
        modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp).testTag("skill-item-${item.skillId}"),
        verticalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Row(
                modifier = Modifier.weight(1f),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(text = item.name, style = MaterialTheme.typography.titleSmall)
                Text(
                    text = stringResource(
                        if (item.scope == SkillScope.COMMON) R.string.skills_scope_common else R.string.skills_scope_personal,
                    ),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Switch(
                checked = item.enabled,
                onCheckedChange = onToggle,
                enabled = enabled && item.state != SkillPoolState.ARCHIVED,
                modifier = Modifier.testTag("skill-switch-${item.skillId}"),
            )
        }
        if (item.description.isNotBlank()) {
            Text(
                text = item.description,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Text(
            text = stringResource(poolStateLabel(item.state)),
            style = MaterialTheme.typography.labelSmall,
            color = when (item.state) {
                SkillPoolState.IN_CATALOG -> MaterialTheme.colorScheme.primary
                SkillPoolState.SHADOWED -> MaterialTheme.colorScheme.secondary
                else -> MaterialTheme.colorScheme.onSurfaceVariant
            },
        )
        item.shadowedBy?.let { shadower ->
            Text(
                text = stringResource(R.string.skills_shadowed_by, shadower.name),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        val archiveScope = stringResource(
            if (item.actions.archive == SkillActionTarget.EVERYONE) R.string.skills_action_everyone
            else R.string.skills_action_owner,
        )
        Text(
            text = stringResource(R.string.skills_action_scope, archiveScope),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

private fun poolStateLabel(state: Int): Int = when (state) {
    SkillPoolState.IN_CATALOG -> R.string.skills_state_in_catalog
    SkillPoolState.SHADOWED -> R.string.skills_state_shadowed
    SkillPoolState.DISABLED -> R.string.skills_state_disabled
    SkillPoolState.ARCHIVED -> R.string.skills_state_archived
    else -> R.string.skills_state_unknown
}

@Composable
private fun PendingSkillRow(candidate: PendingSkill, onOpenPending: (Long) -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable { onOpenPending(candidate.candidateId) }
            .padding(vertical = 10.dp)
            .testTag("skill-pending-${candidate.candidateId}"),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = candidate.name.ifBlank { "#${candidate.candidateId}" },
            style = MaterialTheme.typography.bodyMedium,
            modifier = Modifier.weight(1f),
        )
        Text(
            text = stringResource(R.string.skills_pending_item),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

/** The backend's own words, or the localized "unreachable" for a lost connection. */
@Composable
private fun SkillsFailureBanner(failure: SkillsFailure?) {
    if (failure == null) return
    Spacer(Modifier.height(12.dp))
    Text(
        text = if (failure.unreachable) {
            stringResource(R.string.skills_unreachable)
        } else {
            "${failure.code}: ${failure.message}"
        },
        color = MaterialTheme.colorScheme.error,
        style = MaterialTheme.typography.bodySmall,
    )
}
