package me.rerere.rikkahub.ui.identity

import me.rerere.rikkahub.data.remote.AccountSession

/** Intent coordinates identify a target; only the current account and backend may admit it. */
data class RemoteNotificationTarget(val endpoint: String, val userShortId: Int, val sessionId: String)

/** The skills page a skill reminder opens, gated by the same endpoint/account rule. */
data class SkillsNotificationTarget(val endpoint: String, val userShortId: Int)

/**
 * The one admission rule both notification kinds share: the coordinates name this
 * deployment and the signed-in account, or nothing happens.
 *
 * The endpoint comparison normalises a trailing slash. Publishers already send the
 * canonical spelling, but the Activity is exported, so an intent replayed from
 * outside the app is not required to.
 */
internal fun admits(
    endpoint: String,
    userShortId: Int,
    configuredEndpoint: String,
    account: AccountSession,
): Boolean {
    val identity = account.identity.value ?: return false
    return endpoint.trimEnd('/') == configuredEndpoint.trimEnd('/') && userShortId == identity.user.shortId
}

suspend fun openRemoteNotification(
    target: RemoteNotificationTarget,
    endpoint: String,
    account: AccountSession,
    openOwnedSession: suspend (String) -> Boolean,
): Boolean {
    val identity = account.identity.value ?: return false
    if (!admits(target.endpoint, target.userShortId, endpoint, account)) return false
    if (!openOwnedSession(target.sessionId)) return false
    return account.identity.value == identity
}

/**
 * Whether a skill reminder may open the skills page: the shared admission rule and
 * nothing else.
 *
 * A reminder only navigates, so this is synchronous and consults no session
 * ownership — a skills reminder must not gain the conversation reminder's access.
 */
fun openSkillsNotification(target: SkillsNotificationTarget, endpoint: String, account: AccountSession): Boolean =
    admits(target.endpoint, target.userShortId, endpoint, account)
