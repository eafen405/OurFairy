package me.rerere.rikkahub.ui.identity

import android.os.Bundle
import android.os.SystemClock
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Text
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Modifier
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import me.rerere.rikkahub.data.remote.RemoteChatApi
import me.rerere.rikkahub.data.remote.RemoteChatProjection
import me.rerere.rikkahub.data.remote.RemoteChatState
import me.rerere.rikkahub.ui.fairy.FairyAppTheme
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject

/** #214's network measurement: real HTTP adapter, receive state and transcript; perf APK only. */
class StreamingRateActivity : ComponentActivity() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val applied = JSONArray()
    private val presented = JSONArray()
    private val complete = CompletableDeferred<Unit>()
    private var running = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val endpoint = requireNotNull(intent.getStringExtra("endpoint"))
        val token = requireNotNull(intent.getStringExtra("token"))
        val sessionId = requireNotNull(intent.getStringExtra("sessionId"))
        val resultEndpoint = requireNotNull(intent.getStringExtra("resultEndpoint"))
        val client = OkHttpClient()
        val state = RemoteChatState(RemoteChatApi(endpoint, client), scope, InMemoryChatSyncStore(), endpoint)

        scope.launch {
            var version = -1L
            state.snapshot.collect { snapshot ->
                val projection = snapshot.projection ?: return@collect
                if (projection.version == version) return@collect
                version = projection.version
                applied.put(sample(projection))
            }
        }
        setContent {
            FairyAppTheme {
                val snapshot by state.snapshot.collectAsStateWithLifecycle()
                val projection = snapshot.projection
                LaunchedEffect(projection?.version) {
                    if (projection != null) {
                        withFrameNanos { }
                        presented.put(sample(projection))
                        if (projection.replyStatus != 0) running = true
                        if (running && projection.replyStatus == 0) complete.complete(Unit)
                    }
                }
                Column(Modifier.fillMaxSize()) {
                    Text("流式速率测量 / #214")
                    RemoteTranscript(
                        messages = projection?.messages.orEmpty(),
                        attemptText = projection?.attempt?.text,
                        attemptKey = projection?.let { it.generation to it.attempt?.attemptId },
                        downloadEnabled = false,
                        onDownload = { _, _ -> },
                        settledAttempt = projection?.let { p ->
                            p.settledAttempt?.let { attemptRowKey(p.generation, it.attemptId) to it.seq }
                        },
                    )
                }
            }
        }
        scope.launch {
            val result = JSONObject()
            try {
                state.bind(token, sessionId, 1)
                withTimeout(15_000) {
                    while (!state.snapshot.value.connected) delay(10)
                }
                post(client, "$resultEndpoint/ready", "{}")
                withTimeout(90_000) { complete.await() }
                // Include the terminal checkpoint publication if it follows the first idle frame.
                delay(250)
            } catch (failure: Exception) {
                result.put("error", failure.javaClass.simpleName)
            }
            result.put("applied", applied)
            result.put("presented", presented)
            result.put("failure", state.snapshot.value.failure)
            try {
                post(client, "$resultEndpoint/result", result.toString())
            } finally {
                finish()
            }
        }
    }

    private fun sample(projection: RemoteChatProjection) = JSONObject().apply {
        put("atMs", SystemClock.elapsedRealtimeNanos() / 1_000_000.0)
        put("version", projection.version)
        put("revision", projection.attempt?.revision)
        // Position orders presentation, so the newest output is the greatest seq, not the last row.
        put("chars", projection.attempt?.text?.length
            ?: projection.messages.filter { it.role == 2 }.maxByOrNull { it.seq }?.text?.length ?: 0)
        put("replyStatus", projection.replyStatus)
    }

    private suspend fun post(client: OkHttpClient, url: String, body: String) = withContext(Dispatchers.IO) {
        client.newCall(Request.Builder().url(url)
            .post(body.toRequestBody("application/json".toMediaType())).build()).execute().use {
            check(it.isSuccessful) { "measurement collector refused the result" }
        }
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }
}
