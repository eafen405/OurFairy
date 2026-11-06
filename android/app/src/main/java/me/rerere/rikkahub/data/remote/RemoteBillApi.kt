package me.rerere.rikkahub.data.remote

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.IOException

/**
 * The provider's four disjoint token buckets, as the bill reports them.
 *
 * They are kept apart rather than summed on the wire because input, cache reads,
 * cache writes and output are the four figures the provider actually charged for;
 * [total] is this client's single reading of them, and the backend's own Denny is
 * the same sum at the narrative rate.
 */
@Serializable
data class BillTokens(
    val inputTokens: Long = 0,
    val cacheReadTokens: Long = 0,
    val cacheWriteTokens: Long = 0,
    val outputTokens: Long = 0,
) {
    /** The four buckets' sum: the token figure the bill quotes beside its Denny. */
    val total: Long get() = inputTokens + cacheReadTokens + cacheWriteTokens + outputTokens
}

/**
 * One total in both units.
 *
 * [denny] comes off the wire instead of being computed here: the rate is the
 * backend's narrative constant, and #319's README says adjusting it is one edit
 * that never re-derives history. A client that divided by its own copy of 3000
 * would print a second answer the day that constant moved.
 */
@Serializable
data class BillTotal(
    val tokens: BillTokens = BillTokens(),
    val denny: Double = 0.0,
)

/** One day of the trailing series; a day with no spend is present at zero. */
@Serializable
data class BillDay(
    /** The local civil date, `YYYY-MM-DD`, as the backend cut it in Asia/Shanghai. */
    val day: String = "",
    val tokens: BillTokens = BillTokens(),
    val denny: Double = 0.0,
)

/** One reading of the bill: three totals and the trailing 30-day series. */
@Serializable
data class Bill(
    val today: BillTotal = BillTotal(),
    val month: BillTotal = BillTotal(),
    val allTime: BillTotal = BillTotal(),
    val days: List<BillDay> = emptyList(),
) {
    /**
     * Whether nothing has been spent at all time.
     *
     * This is the empty state's own predicate, and it is deliberately not "the
     * series is all zero": a deployment whose whole spend predates the trailing
     * 30 days has an empty chart but a real bill, and calling that "no spend"
     * would contradict the total printed above it.
     */
    val isEmpty: Boolean get() = allTime.tokens.total == 0L
}

/** The bill operations this app performs. [RemoteBillApi] is the HTTP implementation. */
interface BillBackend {
    /**
     * Read this deployment's one bill.
     *
     * The address takes no subject: the bill is the Fairy's public total, so it
     * is the credential's presence the backend checks, never who the caller is.
     */
    suspend fun read(token: String): Bill
}

@Serializable
internal data class BillEnvelope(
    val ok: Boolean = false,
    val bill: Bill? = null,
    val error: Failure? = null,
) {
    @Serializable
    internal data class Failure(val code: String, val message: String = "")
}

/**
 * The bill's one address, over the app's existing HTTP client.
 *
 * `GET /bill` is a read, not a command: it names no subject and sends no
 * document, so it keeps its own call shape instead of the `POST` document every
 * other product address in this package sends.
 *
 * Failures reuse [IdentityRefused] and [IdentityUnreachable] rather than adding a
 * parallel error vocabulary: the envelope is the same
 * `{ok:false, error:{code,message}}` document as the rest of the product, so the
 * backend's own `bill/unauthorized`, `bill/forbidden-authority` or `bill/internal`
 * reaches the page. That matters here more than elsewhere — a failed aggregate
 * that was adopted as a body would read as a bill of zeros, and #322 asks for the
 * failure to be shown instead.
 */
class RemoteBillApi(
    baseUrl: String,
    client: OkHttpClient,
    private val json: Json = Json { ignoreUnknownKeys = true },
) : BillBackend {

    private val baseUrl = baseUrl.trimEnd('/')

    /** A redirect would carry the Bearer credential somewhere it was not granted. */
    private val client: OkHttpClient = client.newBuilder()
        .followRedirects(false)
        .followSslRedirects(false)
        .retryOnConnectionFailure(false)
        .build()

    override suspend fun read(token: String): Bill = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url("$baseUrl/bill")
            .header("Authorization", "Bearer $token")
            .build()

        val response = try {
            client.newCall(request).execute()
        } catch (unreachable: IOException) {
            throw IdentityUnreachable(unreachable)
        }

        response.use {
            val text = it.body.string()
            val envelope = runCatching { json.decodeFromString<BillEnvelope>(text) }.getOrNull()
                ?: throw IdentityUnreachable(
                    IllegalStateException("the backend answered ${it.code} with an unreadable document"),
                )
            // A `200`-shaped body does not make a failed status a success; both have
            // to agree before the bill is adopted, exactly as SessionApi requires.
            if (!it.isSuccessful || !envelope.ok) {
                val failure = envelope.error
                throw IdentityRefused(
                    status = it.code,
                    code = failure?.code ?: "bill/unknown",
                    message = failure?.message?.takeIf { message -> message.isNotEmpty() } ?: text,
                )
            }
            envelope.bill ?: throw IdentityUnreachable(
                IllegalStateException("the backend accepted the bill read without a bill"),
            )
        }
    }
}
