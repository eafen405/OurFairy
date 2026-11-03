package me.rerere.rikkahub.data.remote

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import java.security.MessageDigest

/**
 * One account's durable "already notified" set, in its canonical form.
 *
 * The endpoint is stored without a trailing slash, exactly like [ChatSyncKey], so the writer and
 * the reminder scan cannot disagree about which account a set belongs to.
 */
data class SkillsReviewKey(val endpoint: String, val userShortId: Int) {
    init {
        require(!endpoint.endsWith('/')) { "技能提醒记录键的 endpoint 必须以无尾斜杠的形式传入" }
    }
}

/**
 * The version ids this account has already seen in each set.
 *
 * `pending` is the last observed pending set and `decided` the last observed terminal decisions.
 * They are bookkeeping only: the candidate rows stay on the backend.
 */
@Serializable
data class SkillsReviewRecord(
    val pending: List<Long> = emptyList(),
    val decided: List<Long> = emptyList(),
)

/** The durable ledger the client's notify-once rule reads and consumes. */
interface SkillsReviewLedger {
    suspend fun load(key: SkillsReviewKey): SkillsReviewRecord

    suspend fun save(key: SkillsReviewKey, record: SkillsReviewRecord)
}

/** Small per-deployment/account bookkeeping for skill reminders, with awaited local commits. */
class AndroidSkillsReviewLedger(context: Context) : SkillsReviewLedger {

    private val preferences =
        context.applicationContext.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)

    private val json = Json { ignoreUnknownKeys = true }

    override suspend fun load(key: SkillsReviewKey): SkillsReviewRecord = withContext(Dispatchers.IO) {
        try {
            val stored = preferences.getString(key.preferenceKey(), null)
                ?: return@withContext SkillsReviewRecord()
            json.decodeFromString<SkillsReviewRecord>(stored)
        } catch (unreadable: SerializationException) {
            SkillsReviewRecord()
        } catch (mistyped: ClassCastException) {
            SkillsReviewRecord()
        }
    }

    override suspend fun save(key: SkillsReviewKey, record: SkillsReviewRecord) {
        withContext(Dispatchers.IO) {
            val written = json.encodeToString(record)
            check(preferences.edit().putString(key.preferenceKey(), written).commit()) {
                "the skills review record could not be written"
            }
        }
    }

    private fun SkillsReviewKey.preferenceKey(): String {
        val canonical = json.encodeToString(KeyTuple(endpoint, userShortId))
        val digest = MessageDigest.getInstance("SHA-256").digest(canonical.toByteArray(Charsets.UTF_8))
        return buildString(digest.size * 2) {
            for (byte in digest) {
                val value = byte.toInt() and 0xFF
                append(HEX[value ushr 4])
                append(HEX[value and 0x0F])
            }
        }
    }

    @Serializable
    private data class KeyTuple(val endpoint: String, val userShortId: Int)

    private companion object {
        const val PREFERENCES_NAME = "ourfairy.skills-review"
        const val HEX = "0123456789abcdef"
    }
}
