package expo.modules.networkinfo

import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.wifi.WifiManager
import android.os.BatteryManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.net.Inet4Address

class ExpoNetworkInfoModule : Module() {
  private var hotspot: WifiManager.LocalOnlyHotspotReservation? = null

  override fun definition() = ModuleDefinition {
    Name("ExpoNetworkInfo")

    // {ssid,bssid,rssi,frequency,linkSpeed,ip,error?}. BSSID/SSID need ACCESS_FINE_LOCATION + location on.
    AsyncFunction("getWifi") {
      val ctx = appContext.reactContext ?: throw IllegalStateException("React context not available")
      val out = mutableMapOf<String, Any?>()
      try {
        val cm = ctx.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val lp = cm.activeNetwork?.let { cm.getLinkProperties(it) }
        out["ip"] = lp?.linkAddresses?.map { it.address }?.firstOrNull { it is Inet4Address }?.hostAddress
        @Suppress("DEPRECATION")
        val wi = (ctx.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager).connectionInfo
        val ssid = wi?.ssid?.trim('"')?.takeIf { it != "<unknown ssid>" }
        val bssid = wi?.bssid?.takeIf { it != "02:00:00:00:00:00" }
        out["ssid"] = ssid; out["bssid"] = bssid
        out["rssi"] = wi?.rssi; out["frequency"] = wi?.frequency; out["linkSpeed"] = wi?.linkSpeed
        if (ssid == null || bssid == null) out["error"] = "SSID/BSSID unbekannt: Standort-Berechtigung (genau) + Standort an nötig"
      } catch (e: Exception) { out["error"] = "FEHLER WLAN-Info: ${e.message}" }
      out
    }

    AsyncFunction("getInfo") {
      val ctx = appContext.reactContext ?: throw IllegalStateException("React context not available")
      val cm = ctx.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
      val net = cm.activeNetwork
      val caps = net?.let { cm.getNetworkCapabilities(it) }
      val lp = net?.let { cm.getLinkProperties(it) }
      val ip = lp?.linkAddresses?.map { it.address }?.firstOrNull { it is Inet4Address }?.hostAddress
      val prefix = lp?.linkAddresses?.firstOrNull { it.address is Inet4Address }?.prefixLength
      val gateway = lp?.routes?.firstOrNull { it.isDefaultRoute && it.gateway is Inet4Address }?.gateway?.hostAddress
      var ssid: String? = null
      var ssidError: String? = null
      try {
        @Suppress("DEPRECATION")
        val wi = (ctx.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager).connectionInfo
        ssid = wi?.ssid?.trim('"')
        if (ssid == null || ssid == "<unknown ssid>") { ssid = null; ssidError = "SSID unbekannt (Standort-Berechtigung + Standort an nötig)" }
      } catch (e: Exception) { ssidError = e.message }
      mapOf(
        "transport" to when {
          caps == null -> "none"
          caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
          caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "cellular"
          caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "ethernet"
          else -> "other"
        },
        "ssid" to ssid,
        "ssidError" to ssidError,
        "bssid" to try { @Suppress("DEPRECATION") (ctx.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager).connectionInfo?.bssid?.takeIf { it != "02:00:00:00:00:00" } } catch (e: Exception) { null },
        "ip" to ip,
        "prefixLength" to prefix,
        "gateway" to gateway,
        "dns" to (lp?.dnsServers?.mapNotNull { it.hostAddress } ?: emptyList<String>()),
        "interfaceName" to lp?.interfaceName
      )
    }

    // Alle IPv4-Adressen außer Loopback. Die JS-Schicht wählt WLAN vor Hotspot.
    AsyncFunction("getLanCandidates") {
      val out = mutableListOf<Map<String, String>>()
      val ifaces = java.net.NetworkInterface.getNetworkInterfaces()
      if (ifaces != null) {
        while (ifaces.hasMoreElements()) {
          val iface = ifaces.nextElement()
          if (iface.isUp && !iface.isLoopback) {
            val addresses = iface.inetAddresses
            while (addresses.hasMoreElements()) {
              val addr = addresses.nextElement()
              if (addr is Inet4Address && !addr.isLoopbackAddress) {
                val host = addr.hostAddress
                if (host != null) out.add(mapOf("name" to iface.name, "ip" to host))
              }
            }
          }
        }
      }
      out
    }

    // Lokaler Hotspot ohne Internetfreigabe. Zugangsdaten gibt es nur, wenn Android sie herausgibt.
    AsyncFunction("startLocalOnlyHotspot") { promise: Promise ->
      val ctx = appContext.reactContext
      if (ctx == null) {
        promise.resolve(mapOf("ok" to false, "reason" to "context"))
        return@AsyncFunction
      }
      val app = ctx.applicationContext
      Handler(Looper.getMainLooper()).post {
        try {
          if (Build.VERSION.SDK_INT < 26) {
            promise.resolve(mapOf("ok" to false, "reason" to "old"))
            return@post
          }
          val wm = app.getSystemService(Context.WIFI_SERVICE) as WifiManager
          try { hotspot?.close() } catch (_: Exception) {}
          hotspot = null
          wm.startLocalOnlyHotspot(object : WifiManager.LocalOnlyHotspotCallback() {
            override fun onStarted(reservation: WifiManager.LocalOnlyHotspotReservation) {
              hotspot = reservation
              val creds = hotspotCreds(reservation)
              promise.resolve(mapOf("ok" to true, "ssid" to creds.first, "password" to creds.second))
            }
            override fun onFailed(reason: Int) {
              promise.resolve(mapOf("ok" to false, "reason" to "failed:$reason"))
            }
          }, Handler(Looper.getMainLooper()))
        } catch (_: SecurityException) {
          promise.resolve(mapOf("ok" to false, "reason" to "permission"))
        } catch (e: Exception) {
          promise.resolve(mapOf("ok" to false, "reason" to (e.message ?: "error")))
        }
      }
    }

    Function("stopLocalOnlyHotspot") {
      try { hotspot?.close() } catch (_: Exception) {}
      hotspot = null
      true
    }

    Function("openTetherSettings") {
      val ctx = appContext.reactContext ?: return@Function false
      val tether = Intent("android.settings.TETHER_SETTINGS").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      try {
        ctx.startActivity(tether)
        true
      } catch (_: Exception) {
        try {
          ctx.startActivity(Intent(Settings.ACTION_WIRELESS_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
          true
        } catch (_: Exception) {
          false
        }
      }
    }

    AsyncFunction("getBattery") {
      val ctx = appContext.reactContext ?: throw IllegalStateException("React context not available")
      val intent = ctx.registerReceiver(null, android.content.IntentFilter(Intent.ACTION_BATTERY_CHANGED))
      val level = intent?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
      val scale = intent?.getIntExtra(BatteryManager.EXTRA_SCALE, 100) ?: 100
      val status = intent?.getIntExtra(BatteryManager.EXTRA_STATUS, -1) ?: -1
      val pct = if (level >= 0 && scale > 0) (level * 100) / scale else -1
      val charging = status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL
      mapOf("level" to pct, "charging" to charging)
    }
  }

  private fun hotspotCreds(reservation: WifiManager.LocalOnlyHotspotReservation): Pair<String, String> {
    var ssid = ""
    var password = ""
    if (Build.VERSION.SDK_INT >= 30) {
      val soft = reservation.softApConfiguration
      val raw = soft?.wifiSsid?.toString()?.trim()?.trim('"') ?: ""
      if (raw.isNotEmpty() && raw != "<unknown ssid>") ssid = raw
      val pass = soft?.passphrase
      if (!pass.isNullOrEmpty()) password = pass
    }
    if ((ssid.isEmpty() || password.isEmpty()) && Build.VERSION.SDK_INT < 33) {
      @Suppress("DEPRECATION")
      val cfg = reservation.wifiConfiguration
      if (cfg != null) {
        if (ssid.isEmpty()) ssid = cfg.SSID?.trim()?.trim('"') ?: ""
        if (password.isEmpty()) password = cfg.preSharedKey?.trim()?.trim('"') ?: ""
      }
    }
    return ssid to password
  }
}
