package me.rerere.rikkahub.data.remote

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException

/** Which scope one action affects: this user only, or every user. Mirrors the backend codes. */
object SkillActionTarget {
    const val OWNER = 1
    const val EVERYONE = 2
}

/** Skill identity scope: the caller's own skill, or a deployment-common one. */
object SkillScope {
    const val PERSONAL = 1
    const val COMMON = 2
}

/**
 * The backend's derived pool state. The client renders these numbers; it never recomputes a
 * winner, a shadow or an archive from the raw rows.
 */
object SkillPoolState {
    const val IN_CATALOG = 1
    const val SHADOWED = 2
    const val DISABLED = 3
    const val ARCHIVED = 4
}

/** The numeric scope each action offers, as `/skills/list` reports it. */
@Serializable
data class SkillActionScopes(
    val toggle: Int = SkillActionTarget.OWNER,
    val archive: Int = SkillActionTarget.OWNER,
    val restore: Int = SkillActionTarget.OWNER,
)

/** The personal identity shadowing a same-name common item, when the backend reports one. */
@Serializable
data class SkillShadower(
    val skillId: Long,
    val name: String,
)

/**
 * One selection-pool item, exactly as the backend derives it.
 *
 * [state] is a [SkillPoolState] code; [scope] a [SkillScope] code; [actions] carries who each
 * action affects as [SkillActionTarget] codes. [enabled] is the effective preference (a personal
 * skill with no stored preference is on, a common one is off). [shadowedBy] is present only on a
 * shadowed common item. `pendingRevision` is false until the version-review ticket fills it.
 */
@Serializable
data class SkillPoolItem(
    val skillId: Long,
    val name: String,
    val description: String = "",
    val scope: Int,
    val state: Int,
    val enabled: Boolean = false,
    val currentVersionId: Long? = null,
    val pendingRevision: Boolean = false,
    val shadowedBy: SkillShadower? = null,
    val actions: SkillActionScopes = SkillActionScopes(),
)

/**
 * One pending candidate in the review area, exactly as the backend derives it. The pending entry
 * opens the caller's primary conversation through `/skills/review-open`; the id that route takes is
 * [versionId], the candidate identity.
 */
@Serializable
data class PendingSkill(
    val versionId: Long,
    val skillId: Long = 0,
    val name: String = "",
    val scope: Int = SkillScope.PERSONAL,
    val sourceType: Int = 0,
    val createdAt: Long = 0,
    val growthExceeded: Boolean = false,
    val nextActions: List<String> = emptyList(),
)

/** The selection pool plus the separate review area, as one list response carries them. */
data class SkillPool(
    val skills: List<SkillPoolItem> = emptyList(),
    val pending: List<PendingSkill> = emptyList(),
    val pendingCount: Int = 0,
)

/** The skills operations this app performs. [SkillsApi] is the HTTP implementation. */
interface SkillsBackend {
    /** Read this credential's own visible skills and their derived state. */
    suspend fun list(token: String): SkillPool

    /** Read one visible skill's bounded detail. */
    suspend fun detail(token: String, skillId: Long): SkillPoolItem

    /** Set this credential's own enable preference and answer the backend's updated item. */
    suspend fun setEnabled(token: String, skillId: Long, enabled: Boolean): SkillPoolItem

    /** Append the candidate reference to the user's primary session and answer that session id. */
    suspend fun reviewOpen(token: String, versionId: Long): String
}

@Serializable
internal data class SkillsEnvelope(
    val ok: Boolean = false,
    val skills: List<SkillPoolItem> = emptyList(),
    val skill: SkillPoolItem? = null,
    val pending: List<PendingSkill> = emptyList(),
    val pendingCount: Int = 0,
    val sessionId: String? = null,
    val error: Failure? = null,
) {
    @Serializable
    internal data class Failure(val code: String, val message: String = "")
}

@Serializable
private data class SkillDetailDocument(val skillId: Long)

@Serializable
private data class SkillPreferenceDocument(val skillId: Long, val enabled: Boolean)

@Serializable
private data class SkillReviewOpenDocument(val versionId: Long)

/**
 * The user's own skill selection endpoints, over the app's existing HTTP client.
 *
 * Every request presents the same Bearer credential that names the account. There is no owner
 * or short number on the wire: the backend derives the pool from the credential, so this client
 * cannot widen its scope. Numeric enums stay mirrored as the constants above.
 *
 * Failures reuse [IdentityRefused] and [IdentityUnreachable]; the backend's own code reaches the
 * page unchanged instead of becoming a generic failure.
 */
class SkillsApi(
    private val baseUrl: String,
    private val client: OkHttpClient,
    private val json: Json = Json { ignoreUnknownKeys = true },
) : SkillsBackend {

    override suspend fun list(token: String): SkillPool {
        val envelope = call("/skills/list", "{}", token)
        return SkillPool(skills = envelope.skills, pending = envelope.pending, pendingCount = envelope.pendingCount)
    }

    override suspend fun detail(token: String, skillId: Long): SkillPoolItem {
        val document = json.encodeToString(SkillDetailDocument.serializer(), SkillDetailDocument(skillId))
        return call("/skills/detail", document, token).skill
            ?: throw IdentityUnreachable(IllegalStateException("the backend accepted a skill detail read without a skill"))
    }

    override suspend fun setEnabled(token: String, skillId: Long, enabled: Boolean): SkillPoolItem {
        val document = json.encodeToString(SkillPreferenceDocument.serializer(), SkillPreferenceDocument(skillId, enabled))
        return call("/skills/preference", document, token).skill
            ?: throw IdentityUnreachable(IllegalStateException("the backend accepted a preference write without an item"))
    }

    override suspend fun reviewOpen(token: String, versionId: Long): String {
        val document = json.encodeToString(SkillReviewOpenDocument.serializer(), SkillReviewOpenDocument(versionId))
        return call("/skills/review-open", document, token).sessionId
            ?: throw IdentityUnreachable(IllegalStateException("the backend accepted a review open without a session"))
    }

    private suspend fun call(path: String, document: String, token: String): SkillsEnvelope =
        withContext(Dispatchers.IO) {
            val request = Request.Builder()
                .url(baseUrl.trimEnd('/') + path)
                .post(document.toRequestBody(JSON_MEDIA_TYPE))
                .header("Authorization", "Bearer $token")
                .build()

            val response = try {
                client.newCall(request).execute()
            } catch (unreachable: IOException) {
                throw IdentityUnreachable(unreachable)
            }

            response.use {
                val text = it.body.string()
                val envelope = runCatching { json.decodeFromString<SkillsEnvelope>(text) }.getOrNull()
                    ?: throw IdentityUnreachable(
                        IllegalStateException("the backend answered ${it.code} with an unreadable document"),
                    )
                if (!envelope.ok || !it.isSuccessful) {
                    val failure = envelope.error
                    throw IdentityRefused(
                        status = it.code,
                        code = failure?.code ?: "skills/unknown",
                        message = failure?.message?.takeIf { message -> message.isNotEmpty() } ?: text,
                    )
                }
                envelope
            }
        }

    private companion object {
        val JSON_MEDIA_TYPE = "application/json; charset=utf-8".toMediaType()
    }
}
