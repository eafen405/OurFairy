package me.rerere.rikkahub.ui.identity

import androidx.annotation.StringRes
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
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
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
import me.rerere.rikkahub.data.remote.PendingSkill
import me.rerere.rikkahub.data.remote.SkillActionTarget
import me.rerere.rikkahub.data.remote.SkillPoolItem
import me.rerere.rikkahub.data.remote.SkillPoolState
import me.rerere.rikkahub.data.remote.SkillReviewResult
import me.rerere.rikkahub.data.remote.SkillScope
import me.rerere.rikkahub.data.remote.SkillVersionStatus
import me.rerere.rikkahub.data.remote.SkillsBackend
import me.rerere.rikkahub.data.remote.SkillsFailure
import me.rerere.rikkahub.data.remote.SkillsSnapshot
import me.rerere.rikkahub.data.remote.SkillsState
import me.rerere.rikkahub.ui.fairy.FairyBackground
import me.rerere.rikkahub.ui.fairy.FairyPresence
import me.rerere.rikkahub.ui.fairy.FairyWindowBarHeight
import me.rerere.rikkahub.ui.fairy.FairyWindowState
import me.rerere.rikkahub.ui.fairy.FairyWindowTopBar
import me.rerere.rikkahub.ui.fairy.LocalFairyTokens
import me.rerere.rikkahub.ui.fairy.StatusChip
import me.rerere.rikkahub.ui.fairy.StatusTone

/** How much of a backend description one row shows before the ellipsis. */
private const val SKILL_DESCRIPTION_LIMIT = 96

/** One bucket for any pool state the client does not know; its rows are still reachable. */
private const val UNKNOWN_POOL_GROUP = -1

/**
 * The user's skill selection pool.
 *
 * The page renders only facts `/skills/list` derives: scope, the pool state (in catalog,
 * shadowed, disabled, archived), the effective switch value, the same-name shadower, the
 * numeric scope of each lifecycle action and the recently decided candidates. It never computes
 * a winner, an archive or a review result itself. Archive and restore are offered only when the
 * backend reports a non-zero action scope (personal: this user; common: Phaethon), and a
 * zero-scope action is not rendered at all. A pending item calls `/skills/review-open`, and the
 * backend answers the caller's primary session id, which the page hands to the host to open the
 * conversation.
 *
 * The pool is not a flat wall of rows: it is grouped by the backend's own state code, only the
 * in-catalog group opens by default, and a local name search filters what is rendered without
 * asking the backend again. A row shows the first sentence of the backend description, capped
 * at [SKILL_DESCRIPTION_LIMIT], because the list exists to pick a skill, not to read it. The
 * header carries the backend's `pendingCount`; the page never derives that number from the
 * pending list it happens to hold.
 */
@Composable
fun SkillsPage(
    onBack: () -> Unit,
    session: AccountSession,
    backend: SkillsBackend,
    onOpenConversation: (String) -> Unit = {},
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

            // The backend's own count, shown at the top so the pending area is visible without
            // opening the skills group in settings and without expanding anything here.
            if (snapshot.loaded && snapshot.pendingCount > 0) {
                Spacer(Modifier.height(8.dp))
                StatusChip(
                    text = stringResource(R.string.skills_pending_badge, snapshot.pendingCount),
                    tone = StatusTone.SIGNAL,
                    modifier = Modifier.testTag("skills-pending-count"),
                )
            }

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
                    SkillPoolSection(
                        skills = snapshot.skills,
                        actionsEnabled = !snapshot.working && token != null,
                        onToggle = { skillId, checked -> token?.let { state.setEnabled(it, skillId, checked) } },
                        onArchive = { skillId -> token?.let { state.archive(it, skillId) } },
                        onRestore = { skillId -> token?.let { state.restore(it, skillId) } },
                    )

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
                            PendingSkillRow(
                                candidate = candidate,
                                enabled = !snapshot.working && token != null,
                                onOpen = {
                                    token?.let { current ->
                                        state.openPending(current, candidate.versionId) { sessionId ->
                                            onOpenConversation(sessionId)
                                        }
                                    }
                                },
                            )
                        }
                    }

                    Spacer(Modifier.height(24.dp))
                    SkillSectionTitle(stringResource(R.string.skills_section_results))
                    if (snapshot.reviewResults.isEmpty()) {
                        Text(
                            text = stringResource(R.string.skills_results_empty),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    } else {
                        snapshot.reviewResults.forEachIndexed { index, result ->
                            if (index > 0) HorizontalDivider(Modifier.padding(vertical = 4.dp))
                            SkillResultRow(result)
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

/**
 * The selection pool, one state group at a time.
 *
 * A non-empty search term replaces the groups with the matching rows: a result must be visible
 * whatever its group's default state is, and the filter only touches the list the page already
 * holds. Empty pools say so instead of rendering a search field over nothing.
 */
@Composable
private fun SkillPoolSection(
    skills: List<SkillPoolItem>,
    actionsEnabled: Boolean,
    onToggle: (Long, Boolean) -> Unit,
    onArchive: (Long) -> Unit,
    onRestore: (Long) -> Unit,
) {
    if (skills.isEmpty()) {
        Text(
            text = stringResource(R.string.skills_empty),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        return
    }

    var query by remember { mutableStateOf("") }
    OutlinedTextField(
        value = query,
        onValueChange = { query = it },
        label = { Text(stringResource(R.string.skills_search_label)) },
        singleLine = true,
        modifier = Modifier.fillMaxWidth().testTag("skills-search"),
    )
    Spacer(Modifier.height(8.dp))

    val term = query.trim()
    if (term.isNotEmpty()) {
        val matches = skills.filter { item -> item.name.contains(term, ignoreCase = true) }
        if (matches.isEmpty()) {
            Text(
                text = stringResource(R.string.skills_search_no_match),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.testTag("skills-search-empty"),
            )
        } else {
            SkillRows(matches, actionsEnabled, onToggle, onArchive, onRestore)
        }
        return
    }

    // The four states the backend derives. An unknown code still reaches the user: it gets its
    // own collapsed bucket instead of being dropped from the list.
    val definitions = listOf(
        PoolGroupDefinition(SkillPoolState.IN_CATALOG, R.string.skills_state_in_catalog, expandedByDefault = true),
        PoolGroupDefinition(SkillPoolState.SHADOWED, R.string.skills_state_shadowed, expandedByDefault = false),
        PoolGroupDefinition(SkillPoolState.DISABLED, R.string.skills_state_disabled, expandedByDefault = false),
        PoolGroupDefinition(SkillPoolState.ARCHIVED, R.string.skills_state_archived, expandedByDefault = false),
    )
    val expanded = remember { mutableStateMapOf<Int, Boolean>() }
    definitions.forEach { definition ->
        val items = skills.filter { item -> item.state == definition.state }
        if (items.isEmpty()) return@forEach
        val open = expanded[definition.state] ?: definition.expandedByDefault
        RenderedSkillGroup(
            groupKey = definition.state.toString(),
            title = definition.title,
            items = items,
            expanded = open,
            onToggleExpanded = { expanded[definition.state] = !open },
            actionsEnabled = actionsEnabled,
            onToggle = onToggle,
            onArchive = onArchive,
            onRestore = onRestore,
        )
    }
    val unknown = skills.filter { item -> definitions.none { definition -> definition.state == item.state } }
    if (unknown.isNotEmpty()) {
        val open = expanded[UNKNOWN_POOL_GROUP] ?: false
        RenderedSkillGroup(
            groupKey = "unknown",
            title = R.string.skills_state_unknown,
            items = unknown,
            expanded = open,
            onToggleExpanded = { expanded[UNKNOWN_POOL_GROUP] = !open },
            actionsEnabled = actionsEnabled,
            onToggle = onToggle,
            onArchive = onArchive,
            onRestore = onRestore,
        )
    }
}

/** One derived pool state and the heading it renders under. */
private data class PoolGroupDefinition(
    val state: Int,
    @StringRes val title: Int,
    val expandedByDefault: Boolean,
)

@Composable
private fun RenderedSkillGroup(
    groupKey: String,
    @StringRes title: Int,
    items: List<SkillPoolItem>,
    expanded: Boolean,
    onToggleExpanded: () -> Unit,
    actionsEnabled: Boolean,
    onToggle: (Long, Boolean) -> Unit,
    onArchive: (Long) -> Unit,
    onRestore: (Long) -> Unit,
) {
    val tokens = LocalFairyTokens.current
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onToggleExpanded)
            .padding(vertical = 10.dp)
            .testTag("skill-group-$groupKey"),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(
            text = stringResource(title),
            style = MaterialTheme.typography.titleSmall,
            fontFamily = tokens.functionFontFamily,
            modifier = Modifier.testTag("skill-group-title-$groupKey"),
        )
        Text(
            text = items.size.toString(),
            style = MaterialTheme.typography.labelSmall,
            fontFamily = tokens.telemetryFontFamily,
            color = tokens.textMuted,
            modifier = Modifier.testTag("skill-group-count-$groupKey"),
        )
        Spacer(Modifier.weight(1f))
        Text(
            text = if (expanded) "−" else "+",
            style = MaterialTheme.typography.labelSmall,
            fontFamily = tokens.telemetryFontFamily,
            color = tokens.fairyLink,
        )
    }
    if (!expanded) return
    SkillRows(items, actionsEnabled, onToggle, onArchive, onRestore)
}

/** One list of pool rows with the page's divider between them. */
@Composable
private fun SkillRows(
    items: List<SkillPoolItem>,
    actionsEnabled: Boolean,
    onToggle: (Long, Boolean) -> Unit,
    onArchive: (Long) -> Unit,
    onRestore: (Long) -> Unit,
) {
    items.forEachIndexed { index, item ->
        if (index > 0) HorizontalDivider(Modifier.padding(vertical = 4.dp))
        SkillRow(
            item = item,
            enabled = actionsEnabled,
            onToggle = { checked -> onToggle(item.skillId, checked) },
            onArchive = { onArchive(item.skillId) },
            onRestore = { onRestore(item.skillId) },
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
private fun SkillRow(
    item: SkillPoolItem,
    enabled: Boolean,
    onToggle: (Boolean) -> Unit,
    onArchive: () -> Unit,
    onRestore: () -> Unit,
) {
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
                text = skillDescriptionExcerpt(item.description),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.testTag("skill-description-${item.skillId}"),
            )
        }
        if (item.pendingRevision) {
            StatusChip(
                text = stringResource(R.string.skills_pending_revision),
                tone = StatusTone.SIGNAL,
                modifier = Modifier.testTag("skill-pending-revision-${item.skillId}"),
            )
        }
        item.shadowedBy?.let { shadower ->
            Text(
                text = stringResource(R.string.skills_shadowed_by, shadower.name),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        val lifecycleScope = if (item.state == SkillPoolState.ARCHIVED) item.actions.restore else item.actions.archive
        if (lifecycleScope != SkillActionTarget.NONE) {
            val scopeLabel = stringResource(
                if (lifecycleScope == SkillActionTarget.EVERYONE) R.string.skills_action_everyone
                else R.string.skills_action_owner,
            )
            Text(
                text = stringResource(R.string.skills_action_scope, scopeLabel),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (item.state == SkillPoolState.ARCHIVED) {
                    OutlinedButton(
                        onClick = onRestore,
                        enabled = enabled,
                        modifier = Modifier.testTag("skill-restore-${item.skillId}"),
                    ) {
                        Text(stringResource(R.string.skills_restore_with_scope, scopeLabel))
                    }
                } else {
                    OutlinedButton(
                        onClick = onArchive,
                        enabled = enabled,
                        modifier = Modifier.testTag("skill-archive-${item.skillId}"),
                    ) {
                        Text(stringResource(R.string.skills_archive_with_scope, scopeLabel))
                    }
                }
            }
        }
    }
}

/**
 * The one-line excerpt of a backend description.
 *
 * Rows exist to pick a skill, so only the first sentence is rendered and a sentence longer than
 * [SKILL_DESCRIPTION_LIMIT] characters is cut with an ellipsis. A full description is the skill's
 * own text and is deliberately not rendered in this list; the client has no detail route for it
 * yet.
 */
internal fun skillDescriptionExcerpt(description: String): String {
    val text = description.trim()
    if (text.isEmpty()) return ""
    val end = firstSentenceEnd(text)
    val first = if (end < 0) text else text.substring(0, end)
    return if (first.length <= SKILL_DESCRIPTION_LIMIT) first
    else first.take(SKILL_DESCRIPTION_LIMIT).trimEnd() + "…"
}

/** The index just past the first sentence ending, or -1 when the text has none. */
private fun firstSentenceEnd(text: String): Int {
    for (index in text.indices) {
        when (text[index]) {
            '。', '！', '？' -> return index + 1
            // An ASCII full stop only ends a sentence when whitespace or the text's end follows,
            // so an abbreviation or a dotted id inside the sentence does not cut it.
            '.', '!', '?' -> {
                val next = text.getOrNull(index + 1)
                if (next == null || next.isWhitespace()) return index + 1
            }
        }
    }
    return -1
}

/** One recently decided candidate: the backend's status and scope, rendered plainly. */
@Composable
private fun SkillResultRow(result: SkillReviewResult) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp).testTag("skill-result-${result.versionId}"),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = result.name.ifBlank { "#${result.versionId}" },
            style = MaterialTheme.typography.bodyMedium,
            modifier = Modifier.weight(1f),
        )
        Text(
            text = stringResource(
                if (result.scope == SkillScope.COMMON) R.string.skills_scope_common else R.string.skills_scope_personal,
            ),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
            text = stringResource(resultStateLabel(result.status)),
            style = MaterialTheme.typography.labelSmall,
            color = when (result.status) {
                SkillVersionStatus.APPROVED -> MaterialTheme.colorScheme.primary
                SkillVersionStatus.REJECTED -> MaterialTheme.colorScheme.error
                else -> MaterialTheme.colorScheme.onSurfaceVariant
            },
        )
    }
}

private fun resultStateLabel(status: Int): Int = when (status) {
    SkillVersionStatus.APPROVED -> R.string.skills_result_approved
    SkillVersionStatus.REJECTED -> R.string.skills_result_rejected
    SkillVersionStatus.CHANGES_REQUESTED -> R.string.skills_result_changes_requested
    else -> R.string.skills_state_unknown
}

@Composable
private fun PendingSkillRow(candidate: PendingSkill, enabled: Boolean, onOpen: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(enabled = enabled, onClick = onOpen)
            .padding(vertical = 10.dp)
            .testTag("skill-pending-${candidate.versionId}"),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = candidate.name.ifBlank { "#${candidate.versionId}" },
            style = MaterialTheme.typography.bodyMedium,
            modifier = Modifier.weight(1f),
        )
        // The backend derives whether the growth confirmation is due; the page
        // only renders that boolean and never computes a percentage itself.
        if (candidate.growthExceeded) {
            StatusChip(
                text = stringResource(R.string.skills_growth_required),
                tone = StatusTone.WARNING,
                modifier = Modifier.testTag("skill-growth-${candidate.versionId}"),
            )
        }
        Text(
            text = stringResource(
                if (candidate.scope == SkillScope.COMMON) R.string.skills_scope_common else R.string.skills_scope_personal,
            ),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
            text = stringResource(R.string.skills_pending_item),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

/**
 * The backend's own words for a lost connection or an unknown code; a refusal this client knows
 * gets one localized sentence instead. Unknown codes keep `code: message` so an unexpected answer
 * stays diagnosable rather than becoming a generic failure.
 */
@Composable
private fun SkillsFailureBanner(failure: SkillsFailure?) {
    if (failure == null) return
    Spacer(Modifier.height(12.dp))
    Text(
        text = if (failure.unreachable) {
            stringResource(R.string.skills_unreachable)
        } else {
            knownFailureText(failure.code) ?: "${failure.code}: ${failure.message}"
        },
        color = MaterialTheme.colorScheme.error,
        style = MaterialTheme.typography.bodySmall,
        modifier = Modifier.testTag("skills-failure"),
    )
}

/** The localized sentence for a refusal these routes can answer, or null to keep the backend's. */
@Composable
private fun knownFailureText(code: String): String? = when (code) {
    "skills/unauthorized" -> stringResource(R.string.skills_error_unauthorized)
    "skills/forbidden" -> stringResource(R.string.skills_error_forbidden)
    "skills/not-found" -> stringResource(R.string.skills_error_not_found)
    "skills/archived" -> stringResource(R.string.skills_error_archived)
    "skills/not-pending" -> stringResource(R.string.skills_error_not_pending)
    "skills/invalid-request" -> stringResource(R.string.skills_error_invalid_request)
    "skills/internal" -> stringResource(R.string.skills_error_internal)
    else -> null
}
