package me.rerere.rikkahub.di

import android.content.Context
import android.os.SystemClock
import androidx.lifecycle.ProcessLifecycleOwner
import me.rerere.rikkahub.data.remote.RemoteAttachmentApi
import me.rerere.rikkahub.data.remote.RemoteSpeechApi
import me.rerere.rikkahub.data.remote.RemoteSpeechBackend
import me.rerere.rikkahub.data.remote.RemoteAttachmentBackend
import me.rerere.rikkahub.data.remote.RemoteChatApi
import me.rerere.rikkahub.data.remote.RemoteChatBackend
import me.rerere.rikkahub.data.remote.RemoteJobApi
import me.rerere.rikkahub.data.remote.RemoteJobBackend
import me.rerere.rikkahub.data.remote.RemoteChatState
import me.rerere.rikkahub.AppScope
import me.rerere.rikkahub.BuildConfig
import me.rerere.rikkahub.data.remote.RemoteAppUpdate
import me.rerere.rikkahub.data.remote.RemoteReceiveState
import me.rerere.rikkahub.service.AndroidRemoteNotifications
import me.rerere.rikkahub.service.RemoteReceiveController
import me.rerere.rikkahub.service.RemoteReceiveServiceLauncher
import me.rerere.rikkahub.ui.fairy.FairyInteraction
import me.rerere.rikkahub.ui.fairy.FairyUiMemory
import me.rerere.rikkahub.data.remote.AndroidChatSyncStore
import me.rerere.rikkahub.data.remote.ChatSyncStore
import me.rerere.rikkahub.data.remote.AccountSession
import me.rerere.rikkahub.data.remote.AndroidKeystoreCredentialStore
import me.rerere.rikkahub.data.remote.CredentialStore
import me.rerere.rikkahub.data.remote.GatewayApi
import me.rerere.rikkahub.data.remote.GatewayBackend
import me.rerere.rikkahub.data.remote.IdentityApi
import me.rerere.rikkahub.data.remote.IdentityBackend
import me.rerere.rikkahub.data.remote.ImpressionApi
import me.rerere.rikkahub.data.remote.ImpressionBackend
import me.rerere.rikkahub.data.remote.SessionApi
import me.rerere.rikkahub.data.remote.SessionBackend
import okhttp3.OkHttpClient
import org.koin.dsl.module

/** Build-time deployment address; release requires an explicit Gradle property. */
private val identityEndpoint: String = BuildConfig.IDENTITY_ENDPOINT

/** Account identity, owned sessions, remote reception and app updates share one process lifetime. */
val identityModule = module {
    single<CredentialStore> {
        AndroidKeystoreCredentialStore(context = get<Context>())
    }

    single<IdentityBackend> {
        IdentityApi(baseUrl = identityEndpoint, client = get<OkHttpClient>())
    }

    single<SessionBackend> {
        SessionApi(baseUrl = identityEndpoint, client = get<OkHttpClient>())
    }

    single<RemoteChatBackend> {
        RemoteChatApi(baseUrl = identityEndpoint, client = get<OkHttpClient>())
    }

    single<GatewayBackend> {
        GatewayApi(baseUrl = identityEndpoint, client = get<OkHttpClient>())
    }

    single<ImpressionBackend> {
        ImpressionApi(baseUrl = identityEndpoint, client = get<OkHttpClient>())
    }

    single<RemoteAttachmentBackend> { RemoteAttachmentApi(identityEndpoint, get<OkHttpClient>()) }

    single<RemoteSpeechBackend> { RemoteSpeechApi(identityEndpoint, get<OkHttpClient>()) }

    single<RemoteJobBackend> { RemoteJobApi(identityEndpoint, get<OkHttpClient>()) }

    single { RemoteAppUpdate(get<Context>(), get<OkHttpClient>(), identityEndpoint) }

    single<ChatSyncStore> { AndroidChatSyncStore(get<Context>()) }

    single { AndroidRemoteNotifications(get<Context>()) }

    single {
        val runtimeScope = get<AppScope>()
        val notifications = get<AndroidRemoteNotifications>()
        val chatBackend = get<RemoteChatBackend>()
        val syncStore = get<ChatSyncStore>()
        val files = get<RemoteAttachmentBackend>()
        val jobs = get<RemoteJobBackend>()
        RemoteReceiveState(get<SessionBackend>(), runtimeScope, { settles ->
            RemoteChatState(
                chatBackend, runtimeScope, syncStore, identityEndpoint,
                attachmentsBackend = files, jobsBackend = jobs,
                speechBackend = get<RemoteSpeechBackend>(),
                settleReminders = settles,
            )
        }, notifications, { notifications.enabled.value }, syncStore, identityEndpoint)
    }

    single { RemoteReceiveServiceLauncher(get<Context>()) }

    // One interaction owner for the process: both pages ask it for 当前表现, 待机 and 台词. Its
    // clock and line memory are injected here, so the module itself holds no Android clock and a
    // test drives it with a fixed one and an in-memory memory.
    single {
        FairyInteraction(
            now = SystemClock::uptimeMillis,
            random = kotlin.random.Random.Default,
            lines = FairyUiMemory(get<Context>()),
        )
    }

    single {
        // The app-wide foreground fact is the notification boundary's own read; the
        // process lifecycle only tells reception when to ask for it again.
        RemoteReceiveController(get<AccountSession>(), get<RemoteReceiveState>(),
            get<AndroidRemoteNotifications>(), get<RemoteReceiveServiceLauncher>(),
            ProcessLifecycleOwner.get().lifecycle, get<AppScope>())
    }

    single {
        val receiver = get<RemoteReceiveState>()
        AccountSession(
            backend = get<IdentityBackend>(),
            store = get<CredentialStore>(),
            // The publisher binds reception as it publishes the account, so the sessions page
            // never renders a list that belongs to the previous one.
            onAccountChanged = receiver::bindIdentity,
        )
    }
}
