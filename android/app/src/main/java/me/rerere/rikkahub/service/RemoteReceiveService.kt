package me.rerere.rikkahub.service

import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import me.rerere.rikkahub.R
import me.rerere.rikkahub.RouteActivity
import me.rerere.rikkahub.data.remote.AccountSession
import me.rerere.rikkahub.data.remote.SkillsReviewNotifier
import org.koin.android.ext.android.inject

/** A client observation lifetime only. Teardown never stops remote replies or jobs. */
class RemoteReceiveService : Service() {
    private val controller: RemoteReceiveController by inject()
    private val account: AccountSession by inject()
    private val notifications: AndroidRemoteNotifications by inject()
    private val skillsReview: SkillsReviewNotifier by inject()
    override fun onBind(intent: Intent?): IBinder? = null
    private var stoppedReason: String? = null
    /** This service's own poll lifetime; it ends with the service, never with the process. */
    private val pollScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var poll: Job? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // A queued start may arrive after disable or sign-out.
        if (!notifications.enabled.value || !account.isSignedIn) {
            stopSelf()
            return START_NOT_STICKY
        }
        val launch = PendingIntent.getActivity(this, 0, Intent(this, RouteActivity::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val notification = NotificationCompat.Builder(this, AndroidRemoteNotifications.RECEIVE_CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_rikkahub).setContentTitle("Fairy 后台接收")
            .setContentText("保持会话同步；系统可能限制后台连接")
            .setContentIntent(launch).setOngoing(true).build()
        try {
            if (Build.VERSION.SDK_INT >= 34) ServiceCompat.startForeground(this, 3101, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
            else startForeground(3101, notification)
            controller.serviceStarted()
            startSkillsPoll()
        } catch (failure: RuntimeException) {
            stoppedReason = "系统拒绝接收服务：${failure.message}"
            controller.serviceStopped(stoppedReason)
            stopSelf()
        }
        return START_NOT_STICKY
    }

    override fun onTimeout(startId: Int, fgsType: Int) {
        stoppedReason = "系统已停止后台接收；重新打开应用可恢复"
        stopSelf()
    }

    override fun onDestroy() {
        poll?.cancel()
        pollScope.cancel()
        controller.serviceStopped(stoppedReason)
        super.onDestroy()
    }

    /**
     * Poll the bounded skills list while reception runs.
     *
     * The backend has no push channel, and a common candidate or its decision concerns another
     * user's account, so no chat observation would deliver it. One list read per minute is the
     * smallest surface that can publish the existing local reminder while the app is in the
     * background; the notifier itself suppresses foreground and disabled notifications.
     */
    private fun startSkillsPoll() {
        if (poll?.isActive == true) return
        poll = pollScope.launch {
            while (isActive) {
                val identity = account.identity.value
                if (identity != null) {
                    runCatching { skillsReview.observeNow(identity.token, identity.user.shortId) }
                }
                delay(SKILLS_POLL_MILLIS)
            }
        }
    }

    private companion object {
        /** A candidate reminder is not real-time; one pass a minute bounds both cost and noise. */
        const val SKILLS_POLL_MILLIS = 60_000L
    }
}
