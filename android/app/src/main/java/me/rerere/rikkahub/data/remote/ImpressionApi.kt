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
 * The current user's own impression, as the backend reports it.
 *
 * [content] is the whole body; the page shows it in one multi-line field and
 * replaces it whole. [maxCharacters] is the backend's limit in Unicode
 * characters — the page reports it but never clips the draft to it. [updatedAt]
 * is the last write, or null while the user has no impression yet.
 */
@Serializable
data class Impression(
    val content: String = "",
    val updatedAt: Long? = null,
    val maxCharacters: Int = 8000,
)

/** The impression operations this app performs. [ImpressionApi] is the HTTP implementation. */
interface ImpressionBackend {
    /** Read this credential's own impression; a successful read opens the edit. */
    suspend fun read(token: String): Impression

    /** Replace this credential's own impression whole. */
    suspend fun edit(token: String, content: String)
}

@Serializable
internal data class ImpressionEnvelope(
    val ok: Boolean = false,
    val impression: Impression? = null,
    val error: Failure? = null,
) {
    @Serializable
    internal data class Failure(val code: String, val message: String = "")
}

@Serializable
private data class ImpressionDocument(val content: String)

/**
 * The user's own impression endpoints, over the app's existing HTTP client.
 *
 * Each request presents the same Bearer credential that names the account.
 * There is deliberately no short number or other owner field on the wire: the
 * backend derives the row from the credential, so this client cannot ask for
 * somebody else's impression even if it wanted to.
 *
 * Failures reuse [IdentityRefused] and [IdentityUnreachable]: the envelope is
 * the product's `{ok:false, error:{code,message}}` document, so the backend's
 * own code — `impression/not-read`, `impression/too-long` — reaches the page
 * instead of becoming a generic failure.
 */
class ImpressionApi(
    private val baseUrl: String,
    private val client: OkHttpClient,
    private val json: Json = Json { ignoreUnknownKeys = true },
) : ImpressionBackend {

    override suspend fun read(token: String): Impression =
        call("/impression/read", "{}", token).impression
            ?: throw IdentityUnreachable(
                IllegalStateException("the backend accepted the impression read without an impression"),
            )

    override suspend fun edit(token: String, content: String) {
        call("/impression/edit", json.encodeToString(ImpressionDocument.serializer(), ImpressionDocument(content)), token)
    }

    private suspend fun call(path: String, document: String, token: String): ImpressionEnvelope =
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
                val envelope = runCatching { json.decodeFromString<ImpressionEnvelope>(text) }.getOrNull()
                    ?: throw IdentityUnreachable(
                        IllegalStateException("the backend answered ${it.code} with an unreadable document"),
                    )
                if (!envelope.ok || !it.isSuccessful) {
                    val failure = envelope.error
                    throw IdentityRefused(
                        status = it.code,
                        code = failure?.code ?: "impression/unknown",
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
