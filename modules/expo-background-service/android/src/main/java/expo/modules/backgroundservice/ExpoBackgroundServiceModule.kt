package expo.modules.backgroundservice

import android.app.Activity
import android.app.Application
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.view.WindowManager
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class ExpoBackgroundServiceModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ExpoBackgroundService")

    AsyncFunction("startService") { promise: Promise ->
      try {
        val context = appContext.reactContext ?: run {
          promise.reject("NO_CONTEXT", "React context not available", null); return@AsyncFunction
        }
        EveryAppBackgroundService.setEnabled(context, true)
        ServiceGate.sync(context, "startService")
        promise.resolve(true)
      } catch (e: Exception) {
        promise.reject("START_SERVICE_FAILED", "${e.javaClass.simpleName}: ${e.message}", e)
      }
    }

    AsyncFunction("stopService") { promise: Promise ->
      try {
        val context = appContext.reactContext ?: run {
          promise.reject("NO_CONTEXT", "React context not available", null); return@AsyncFunction
        }
        EveryAppBackgroundService.setEnabled(context, false)
        ServiceGate.sync(context, "stopService")
        promise.resolve(true)
      } catch (e: Exception) {
        promise.reject("STOP_SERVICE_FAILED", e.message, e)
      }
    }

    Function("setTileLabel") { index: Int, label: String? ->
      val context = appContext.reactContext ?: return@Function false
      EveryAppTileBase.setLabel(context, index, label)
      true
    }

    AsyncFunction("setTileConfig") { slot: Int, json: String? ->
      val context = appContext.reactContext ?: throw IllegalStateException("React context not available")
      UiStore.setTile(context, slot, json?.let { UiStore.inlineRemoteIcons(it) })
      EveryAppTileBase.refresh(context, slot)
      true
    }

    AsyncFunction("setWidgetConfig") { id: String, json: String? ->
      val context = appContext.reactContext ?: throw IllegalStateException("React context not available")
      UiStore.setWidget(context, id, json?.let { UiStore.inlineRemoteIcons(it) })
      EveryAppWidgetBase.updateAll(context)
      true
    }

    Function("getWidgetIds") {
      val context = appContext.reactContext ?: return@Function emptyList<String>()
      UiStore.widgetIds(context)
    }

    Function("nativeLogRead") { appContext.reactContext?.let { NativeLog.read(it) } ?: "[]" }
    Function("nativeLogClear") { appContext.reactContext?.let { NativeLog.clear(it) }; true }

    // Generic popup host (PopupActivity)
    Function("popupSend") { appId: String, id: String, json: String ->
      val context = appContext.reactContext ?: return@Function false
      PopupActivity.send(context, appId, id, json)
    }
    Function("popupClose") { appId: String, id: String? -> PopupActivity.close(appId, id) }
    Function("popupState") { appId: String, id: String ->
      val context = appContext.reactContext ?: return@Function "{}"
      PopupActivity.storedState(context, appId, id).toString()
    }
    Function("popupOpen") { json: String ->
      val context = appContext.currentActivity ?: appContext.reactContext ?: throw IllegalStateException("Kein Context")
      context.startActivity(PopupActivity.open(context, json)); true
    }
    // Lock-screen grant per mini-app (only set from EveryApp's own confirmation dialog, never from mini-app code)
    Function("lockGrantGet") { appId: String -> appContext.reactContext?.let { LockScreen.isGranted(it, appId) } ?: false }
    Function("lockGrantSet") { appId: String, granted: Boolean ->
      val context = appContext.reactContext ?: return@Function false
      LockScreen.setGranted(context, appId, granted)
      UiStore.tileSlotsFor(context, appId).forEach { EveryAppTileBase.refresh(context, it) }
      true
    }
    Function("setHosting") { hosting: Boolean ->
      val context = appContext.reactContext ?: return@Function false
      ServiceGate.setHosting(context, hosting)
      ServiceGate.sync(context, "setHosting")
      true
    }
    Function("setRuntimeNeeds") { interval: Boolean, intervalMs: Double, wifi: Boolean ->
      val context = appContext.reactContext ?: return@Function false
      ServiceGate.setNeeds(context, interval, intervalMs.toLong(), wifi)
      ServiceGate.sync(context, "setRuntimeNeeds")
      true
    }
    Function("isServiceEnabled") {
      val context = appContext.reactContext ?: return@Function false
      EveryAppBackgroundService.isEnabled(context)
    }

    // Open scrapp over the lock screen. The screen is not turned on. Home and app
    // switches clear the flag until the device is unlocked again.
    Function("setShowOverLock") { enabled: Boolean ->
      val activity = appContext.currentActivity ?: return@Function false
      ensureOverLockWatch(activity)
      hostClass = activity.javaClass.name
      wantsOverLock = enabled
      if (!enabled) leftWhileScreenOn = false
      applyOverLock(activity, enabled && !leftWhileScreenOn)
      true
    }

    Function("setOverLockNotice") { appId: String, title: String, action: String, enabled: Boolean ->
      val context = appContext.reactContext ?: return@Function false
      if (enabled) OverLockNotice.show(context, appId, title, action)
      else OverLockNotice.clear(context, appId)
      true
    }
  }

  private var hostClass: String? = null
  private var wantsOverLock = false
  private var leftWhileScreenOn = false
  private var watchInstalled = false

  private val unlockReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
      if (intent.action != Intent.ACTION_USER_PRESENT || !wantsOverLock) return
      leftWhileScreenOn = false
      val activity = appContext.currentActivity ?: return
      if (activity.javaClass.name == hostClass) applyOverLock(activity, true)
    }
  }

  private val activityWatch = object : Application.ActivityLifecycleCallbacks {
    override fun onActivityPaused(activity: Activity) {
      if (!wantsOverLock || activity.javaClass.name != hostClass) return
      val pm = activity.getSystemService(PowerManager::class.java) ?: return
      // Screen-off keeps the flag so the power button reveals the scrapp.
      // Home and switching apps happen while the screen is still on.
      if (pm.isInteractive) {
        leftWhileScreenOn = true
        applyOverLock(activity, false)
      }
    }

    override fun onActivityResumed(activity: Activity) {
      if (!wantsOverLock || activity.javaClass.name != hostClass) return
      if (leftWhileScreenOn && LockScreen.isLocked(activity)) {
        applyOverLock(activity, false)
        return
      }
      leftWhileScreenOn = false
      applyOverLock(activity, true)
    }

    override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) {}
    override fun onActivityStarted(activity: Activity) {}
    override fun onActivityStopped(activity: Activity) {}
    override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) {}
    override fun onActivityDestroyed(activity: Activity) {}
  }

  private fun ensureOverLockWatch(activity: Activity) {
    if (watchInstalled) return
    activity.application.registerActivityLifecycleCallbacks(activityWatch)
    val filter = IntentFilter(Intent.ACTION_USER_PRESENT)
    if (Build.VERSION.SDK_INT >= 33) {
      activity.application.registerReceiver(unlockReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
    } else {
      activity.application.registerReceiver(unlockReceiver, filter)
    }
    watchInstalled = true
  }

  private fun applyOverLock(activity: Activity, show: Boolean) {
    activity.runOnUiThread {
      try {
        if (Build.VERSION.SDK_INT >= 27) {
          activity.setShowWhenLocked(show)
          activity.setTurnScreenOn(false)
        } else {
          @Suppress("DEPRECATION")
          if (show) activity.window.addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED)
          else activity.window.clearFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED)
          @Suppress("DEPRECATION")
          activity.window.clearFlags(WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON)
        }
      } catch (e: Throwable) {
        NativeLog.add(activity, "FEHLER showWhenLocked: ${e.javaClass.simpleName}: ${e.message}")
      }
    }
  }

  companion object {
    const val CHANNEL_ID = EveryAppBackgroundService.CHANNEL_ID
  }
}
