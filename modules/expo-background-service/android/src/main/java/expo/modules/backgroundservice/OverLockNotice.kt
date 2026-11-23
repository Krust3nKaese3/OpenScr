package expo.modules.backgroundservice

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat

/**
 * Dismissible lock-screen notice for the last OpenScrapp that opted into
 * show-when-locked. It is not the foreground-service notification: that one
 * cannot be swiped away and dies with the service. This one stays after the
 * process is closed or crashes, and tapping it opens only that scrapp.
 */
object OverLockNotice {
  const val CHANNEL_ID = "openscr_over_lock"
  const val NOTIFICATION_ID = 47
  private const val PREFS = "openscr_over_lock_notice"
  private const val KEY_APP = "appId"

  fun show(ctx: Context, appId: String, title: String, action: String) {
    val app = ctx.applicationContext
    if (appId.isBlank() || title.isBlank()) return
    createChannel(app)
    val pending = pending(app, appId)
    val notice = NotificationCompat.Builder(app, CHANNEL_ID)
      .setSmallIcon(android.R.drawable.ic_menu_compass)
      .setContentTitle(title)
      .setContentText("Tippen zeigt nur diese OpenScrapp über dem Sperrbildschirm.")
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setContentIntent(pending)
      .addAction(NotificationCompat.Action.Builder(0, action, pending).build())
      .setOngoing(false)
      .setAutoCancel(false)
      .setOnlyAlertOnce(true)
      .setPriority(NotificationCompat.PRIORITY_DEFAULT)
      .build()
    manager(app).notify(NOTIFICATION_ID, notice)
    app.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY_APP, appId).apply()
  }

  /** Removes the notice when it belongs to this OpenScrapp, or when appId is null. */
  fun clear(ctx: Context, appId: String?) {
    val app = ctx.applicationContext
    val prefs = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val current = prefs.getString(KEY_APP, null)
    if (!appId.isNullOrBlank() && current != null && current != appId) return
    manager(app).cancel(NOTIFICATION_ID)
    prefs.edit().remove(KEY_APP).apply()
  }

  fun launchIntent(ctx: Context, appId: String): Intent {
    val launch = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName)
    val intent = Intent(Intent.ACTION_VIEW)
    if (launch?.component != null) intent.component = launch.component
    intent.data = Uri.parse("openscr://lock?id=" + Uri.encode(appId))
    intent.addCategory(Intent.CATEGORY_DEFAULT)
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    return intent
  }

  private fun pending(ctx: Context, appId: String): PendingIntent {
    val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    return PendingIntent.getActivity(ctx, NOTIFICATION_ID, launchIntent(ctx, appId), flags)
  }

  private fun createChannel(ctx: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val channel = NotificationChannel(CHANNEL_ID, "Sperrbildschirm", NotificationManager.IMPORTANCE_DEFAULT)
    channel.description = "Öffnet die zuletzt geöffnete OpenScrapp über dem Sperrbildschirm"
    channel.lockscreenVisibility = Notification.VISIBILITY_PUBLIC
    manager(ctx).createNotificationChannel(channel)
  }

  private fun manager(ctx: Context) =
    ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
}
