package me.rerere.rikkahub.ui.identity

import android.app.Application
import android.content.Intent
import android.content.pm.ActivityInfo
import android.content.pm.ResolveInfo
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.FileProvider
import org.robolectric.Shadows.shadowOf

/**
 * FileProvider caches resolved path strategies per authority in a static map, while Robolectric
 * gives every test its own cache directory. A strategy resolved by an earlier test would point at
 * that test's sandbox, so tests that build a provider URI start from a cleared cache.
 */
internal fun clearFileProviderCache() {
    FileProvider::class.java.getDeclaredField("sCache").apply { isAccessible = true }
        .get(null).let { (it as HashMap<*, *>).clear() }
}

/**
 * Makes the real `startActivity` path check that the intent resolves, as a device does. Without
 * this Robolectric records any intent even when no activity accepts it.
 */
internal fun Application.requireActivityResolution() {
    shadowOf(this).checkActivities(true)
}

/** Registers one fake installed activity for exactly [intent], resolved by the package manager. */
internal fun Application.registerActivityFor(intent: Intent) {
    val viewer = ResolveInfo().apply {
        activityInfo = ActivityInfo().apply {
            packageName = "com.example.viewer"
            name = "com.example.viewer.ViewerActivity"
        }
    }
    shadowOf(packageManager).addResolveInfoForIntent(intent, viewer)
}

/** Registers a document target for [mime], so the save-as fallback can start under review. */
internal fun Application.registerDocumentCreator(mime: String) {
    registerActivityFor(ActivityResultContracts.CreateDocument(mime).createIntent(this, "attachment"))
}
