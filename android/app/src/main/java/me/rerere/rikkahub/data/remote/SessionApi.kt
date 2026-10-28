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

/**
 * One of this account's remote sessions, as the backend describes it.
 *
 * [id] is opaque: it is the backend's business how a session is named, and this
 * client must never read meaning out of it — in particular [owner] is not parsed
 * out of the id to decide who may read it. Authorization is the backend's job;
 * this is a projection of what it already decided.
 *
 * [createdAt] is the backend's own creation instant, passed through untouched:
 * the product exposes `createdAt: header.createdAt` from a header whose value is
 * `Date.now()` milliseconds (backend/sessions/src/service.mjs, `expose`), so on
 * the wire it is a number. It is decoded as the number it is rather than
 * accepting a second shape the server never sends.
 *
 * [title] is the session's name for display, already derived by the backend
 * (model title, deterministic fallback, or a user rename). An empty title means
 * the session has no name yet; the list shows a placeholder rather than the raw
 * [id]. [titleSource] is [OwnedSessionTitleSource]; its default keeps an older
 * backend, which sends neither field, decodable.
 */
@Serializable
data class OwnedSession(
    val id: String,
    val owner: String = "",
    val primary: Boolean = false,
    val createdAt: Long = 0L,
    val title: String = "",
    val titleSource: Int = OwnedSessionTitleSource.FALLBACK,
)

/**
 * Wire codes for [OwnedSession.titleSource], mirroring the backend's numeric
 * enum (`TITLE_SOURCE` in `backend/sessions/src/events.ts`): 0 fallback,
 * 1 provider (model), 2 user (rename). The source is meaningful only when the
 * title is non-empty.
 */
object OwnedSessionTitleSource {
    const val FALLBACK = 0
    const val PROVIDER = 1
    const val USER = 2
}

/** The account's sessions together with the one that is permanently its main. */
data class OwnedSessions(
    val sessions: List<OwnedSession>,
    val primarySessionId: String?,
)

/** The session operations this app performs. [SessionApi] is the HTTP implementation. */
interface SessionBackend {
    suspend fun list(token: String): OwnedSessions

    suspend fun create(token: String): OwnedSession

    suspend fun select(token: String, sessionId: String): OwnedSession

    suspend fun primary(token: String): OwnedSession

    suspend fun read(token: String, sessionId: String): OwnedSession

    /**
     * Pin one session's title to [title].
     *
     * The answer is the session row the list would return, so callers adopt it
     * instead of a list read of their own: the drawer row and the conversation's
     * title bar then show the same value the backend folded.
     */
    suspend fun rename(token: String, sessionId: String, title: String): OwnedSession

    /**
     * Archive one session — this product's delete.
     *
     * The log, the messages and the history stay; what changes is that the
     * session is no longer offered in the default list and can be restored.
     * The backend refuses the primary session, which is where replies and
     * notifications land.
     */
    suspend fun archive(token: String, sessionId: String): OwnedSession
}

@Serializable
internal data class SessionEnvelope(
    val ok: Boolean = false,
    val sessions: List<OwnedSession>? = null,
    val session: OwnedSession? = null,
    val primarySessionId: String? = null,
    val error: Failure? = null,
) {
    @Serializable
    internal data class Failure(val code: String, val message: String = "")
}

@Serializable
private data class SessionDocument(val sessionId: String)

@Serializable
private data class RenameDocument(val sessionId: String, val title: String)

/**
 * The remote session endpoints, over the same HTTP client and the same build-time
 * endpoint as [IdentityApi].
 *
 * Every operation is a POST presenting the same Bearer credential that names the
 * account, and no operation takes a caller-chosen user: the backend reads the
 * owner off the credential, so this client cannot ask for somebody else's
 * sessions and cannot ask "as" anyone.
 *
 * Which requests carry a document is not cosmetic. `/sessions/list`,
 * `/sessions/create` and `/sessions/primary` act purely on the presented
 * credential, so they send no body and declare no media type; only
 * `/sessions/select` and `/sessions/read` name a session, and those send
 * `{"sessionId": …}`. Sending a media type the backend was not sent is what
 * earns a `415`, so the bodyless shape is preserved deliberately.
 *
 * Failures reuse [IdentityRefused] and [IdentityUnreachable] rather than
 * introducing a parallel error vocabulary: the envelope is the same
 * `{ok:false,error:{code,message}}` document, and one way to say "refused" is
 * one thing this app has to get right.
 */
class SessionApi(
    private val baseUrl: String,
    private val client: OkHttpClient,
    private val json: Json = Json { ignoreUnknownKeys = true },
) : SessionBackend {

    override suspend fun list(token: String): OwnedSessions {
        val envelope = call("/sessions/list", token = token)
        return OwnedSessions(
            sessions = envelope.sessions.orEmpty(),
            primarySessionId = envelope.primarySessionId,
        )
    }

    override suspend fun create(token: String): OwnedSession =
        call("/sessions/create", token = token).named()

    override suspend fun select(token: String, sessionId: String): OwnedSession =
        call("/sessions/select", document = json.encodeToString(SessionDocument(sessionId)), token = token)
            .named()

    override suspend fun primary(token: String): OwnedSession =
        call("/sessions/primary", token = token).named()

    override suspend fun read(token: String, sessionId: String): OwnedSession =
        call("/sessions/read", document = json.encodeToString(SessionDocument(sessionId)), token = token)
            .named()

    /**
     * `/sessions/rename` is the session family's address, served by the chat
     * module because a rename needs a live session — which module answers it is
     * a backend detail this client does not read into the path. The backend
     * normalizes the title itself (collapsed whitespace, invisible characters
     * removed, an over-long title cut on a UTF-8 boundary) and refuses one that
     * leaves nothing visible with `sessions/empty-title`.
     */
    override suspend fun rename(token: String, sessionId: String, title: String): OwnedSession =
        call("/sessions/rename", document = json.encodeToString(RenameDocument(sessionId, title)), token = token)
            .named()

    override suspend fun archive(token: String, sessionId: String): OwnedSession =
        call("/sessions/archive", document = json.encodeToString(SessionDocument(sessionId)), token = token)
            .named()

    private suspend fun call(
        path: String,
        document: String? = null,
        token: String,
    ): SessionEnvelope = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url(baseUrl.trimEnd('/') + path)
            .apply {
                // An empty body with no media type is what a bodyless POST looks
                // like on the wire; a null media type keeps the header absent.
                post((document ?: "").toRequestBody(document?.let { JSON_MEDIA_TYPE }))
                header("Authorization", "Bearer $token")
            }
            .build()

        val response = try {
            client.newCall(request).execute()
        } catch (unreachable: IOException) {
            throw IdentityUnreachable(unreachable)
        }

        response.use {
            val text = it.body.string()
            val envelope = runCatching { json.decodeFromString<SessionEnvelope>(text) }.getOrNull()
                ?: throw IdentityUnreachable(
                    IllegalStateException("the backend answered ${it.code} with an unreadable document"),
                )
            if (!envelope.ok || !it.isSuccessful) {
                // A `200`-shaped body does not make a failed status a success.
                // Both have to agree before the answer is adopted, exactly as
                // IdentityApi requires, and a genuine refusal keeps the status
                // and the backend's own code so the failure stays meaningful.
                val failure = envelope.error
                throw IdentityRefused(
                    status = it.code,
                    code = failure?.code ?: "sessions/unknown",
                    message = failure?.message?.takeIf { message -> message.isNotEmpty() } ?: text,
                )
            }
            envelope
        }
    }

    private fun SessionEnvelope.named(): OwnedSession = session ?: throw IdentityUnreachable(
        IllegalStateException("the backend accepted the request without naming a session"),
    )

    private companion object {
        val JSON_MEDIA_TYPE = "application/json; charset=utf-8".toMediaType()
    }
}
