/** QR page shared by Songraten and Werwolf. Injected into every mini-app. */
export const QR_SHELL_SOURCE = String.raw`
(function () {
  var icon = '<svg viewBox="0 0 512 512" aria-hidden="true" focusable="false"><rect x="336" y="336" width="80" height="80" rx="8" ry="8" fill="currentColor"/><rect x="272" y="272" width="64" height="64" rx="8" ry="8" fill="currentColor"/><rect x="416" y="416" width="64" height="64" rx="8" ry="8" fill="currentColor"/><rect x="432" y="272" width="48" height="48" rx="8" ry="8" fill="currentColor"/><rect x="272" y="432" width="48" height="48" rx="8" ry="8" fill="currentColor"/><rect x="336" y="96" width="80" height="80" rx="8" ry="8" fill="currentColor"/><rect x="288" y="48" width="176" height="176" rx="16" ry="16" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="32"/><rect x="96" y="96" width="80" height="80" rx="8" ry="8" fill="currentColor"/><rect x="48" y="48" width="176" height="176" rx="16" ry="16" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="32"/><rect x="96" y="336" width="80" height="80" rx="8" ry="8" fill="currentColor"/><rect x="48" y="288" width="176" height="176" rx="16" ry="16" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="32"/></svg>';
  var css = ''
    + '.oqr{display:flex;flex-direction:column;gap:14px;color:#f4f4f5}'
    + '.oqr button,.oqr input{font:inherit;color:inherit}'
    + '.oqr-btn{min-height:52px;border-radius:999px;border:1px solid rgba(255,255,255,.16);background:transparent;color:#f4f4f5;font-weight:700;padding:12px 16px}'
    + '.oqr-btn.solid{background:#A3E635;color:#111;border:0}'
    + '.oqr-btn.ghost{background:#1c1c22;border:0;border-radius:14px}'
    + '.oqr-btn.bad{background:#3f1d1d;color:#FECACA;border:0}'
    + '.oqr-btn{display:inline-flex;align-items:center;justify-content:center;gap:10px}'
    + '.oqr-btn:disabled{opacity:.72}'
    + '.oqr-spin{width:18px;height:18px;border-radius:50%;border:2px solid rgba(254,202,202,.35);border-top-color:#FECACA;animation:oqr-spin .7s linear infinite;flex:0 0 18px}'
    + '@keyframes oqr-spin{to{transform:rotate(360deg)}}'
    + '.oqr-main{display:flex;align-items:center;justify-content:space-between;width:100%;text-align:left}'
    + '.oqr-main svg{width:28px;height:28px;flex:0 0 28px}'
    + '.oqr-panel{display:flex;flex-direction:column;gap:12px}'
    + '.oqr-row{display:flex;gap:8px}'
    + '.oqr-row .oqr-btn{flex:1}'
    + '.oqr input{width:100%;min-height:52px;border-radius:16px;border:1px solid rgba(255,255,255,.08);background:#1c1c22;padding:12px 14px}'
    + '.oqr-note{color:#a1a1aa;line-height:1.45;margin:0}'
    + '.oqr img{width:min(100%,280px);align-self:center;border-radius:16px;background:#fff}';
  var root = null;
  var handlers = {};
  var model = {};
  var bound = false;
  var busy = false;
  var pending = null;
  var started = 0;
  function reveal() {
    var wait = Math.max(0, 450 - (Date.now() - started));
    setTimeout(function () {
      if (!busy) return;
      busy = false;
      if (pending) {
        model = pending;
        pending = null;
      }
      if (root) shell();
    }, wait);
  }
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch];
    });
  }
  function install() {
    if (document.getElementById('openscr-qr-style')) return;
    var style = document.createElement('style');
    style.id = 'openscr-qr-style';
    style.textContent = css;
    document.head.appendChild(style);
  }
  function isGuest() {
    if (model.viewer === 'guest') return true;
    var bridge = window.OpenScrBridge || window.EveryAppBridge;
    return !!(bridge && bridge.guest === true);
  }
  function links() {
    if (!model.share) return '';
    return '<div class="oqr-row"><button type="button" class="oqr-btn ghost" data-qr="copy">' + (model.copied ? 'Kopiert' : 'Link kopieren') + '</button><button type="button" class="oqr-btn ghost" data-qr="share">Teilen</button></div>';
  }
  function hostBody() {
    if (model.open !== 'host') return '';
    if (isGuest()) {
      return (model.note ? '<p class="oqr-note">' + esc(model.note) + '</p>' : '')
        + (model.image ? '<img alt="QR-Code" src="' + esc(model.image) + '">' : '')
        + links();
    }
    var hotspot = model.hostLink === 'hotspot';
    return '<div class="oqr-row">'
      + '<button type="button" class="oqr-btn' + (hotspot ? ' ghost' : ' solid') + '" data-qr="wlan">WLAN</button>'
      + '<button type="button" class="oqr-btn' + (hotspot ? ' solid' : ' ghost') + '" data-qr="hotspot">Hotspot</button></div>'
      + (hotspot
        ? '<form class="oqr" data-qr="hotspot-show"><input id="oqr-ssid" maxlength="64" placeholder="Hotspot-Name" aria-label="Hotspot-Name" value="' + esc(model.ssid || '') + '"><input id="oqr-pass" maxlength="64" placeholder="Hotspot-Passwort" aria-label="Hotspot-Passwort" value="' + esc(model.pass || '') + '"><button class="oqr-btn" type="submit">QR-Code zeigen</button></form>'
        : '')
      + (model.note ? '<p class="oqr-note">' + esc(model.note) + '</p>' : '')
      + (model.image ? '<img alt="QR-Code" src="' + esc(model.image) + '">' : '')
      + links()
      + (busy
        ? '<button type="button" class="oqr-btn bad" data-qr="end-other" disabled aria-busy="true"><span class="oqr-spin" aria-hidden="true"></span>Raum wird beendet</button>'
        : (model.note && String(model.note).indexOf('anderer Raum') !== -1
          ? '<button type="button" class="oqr-btn bad" data-qr="end-other">Alten Raum beenden</button>'
          : '<button type="button" class="oqr-btn bad" data-qr="stop">Hosting beenden</button>'));
  }
  function downloadBody() {
    if (model.open !== 'download') return '';
    return (model.image ? '<img alt="QR-Code zum Herunterladen" src="' + esc(model.image) + '">' : '')
      + (model.note ? '<p class="oqr-note">' + esc(model.note) + '</p>' : '')
      + links();
  }
  function requests() {
    return (model.requests || []).map(function (request) {
      return '<p class="oqr-note">' + esc(request.name) + ' möchte beitreten.</p><div class="oqr-row"><button type="button" class="oqr-btn solid" data-qr="approve" data-id="' + esc(request.id) + '">Zulassen</button><button type="button" class="oqr-btn" data-qr="deny" data-id="' + esc(request.id) + '">Ablehnen</button></div>';
    }).join('');
  }
  function panel(act, label, body) {
    return '<div class="oqr-panel"><button type="button" class="oqr-btn oqr-main" data-qr="' + act + '"><span>' + label + '</span>' + icon + '</button>' + body + '</div>';
  }
  function openHostIfLive() {
    if (isGuest() || model.open || !handlers.onHost) return;
    var bridge = window.OpenScrBridge || window.EveryAppBridge;
    var mp = bridge && bridge.multiplayer;
    if (!mp || typeof mp.live !== 'function') return;
    Promise.resolve(mp.live()).then(function (row) {
      if (!root || !row || row.role !== 'host' || model.open) return;
      handlers.onHost();
    }, function () {});
  }
  function shell() {
    root.innerHTML = '<div class="oqr">'
      + (isGuest() ? '' : panel('scan', 'Code scannen', ''))
      + panel('host', 'Host Multiplayer', hostBody())
      + panel('download', 'Download Scrap', downloadBody())
      + (isGuest() ? '' : requests())
      + '</div>';
  }
  function bind() {
    if (bound) return;
    bound = true;
    document.addEventListener('click', function (event) {
      if (!root || !root.contains(event.target)) return;
      var button = event.target.closest && event.target.closest('[data-qr]');
      if (!button || button.tagName === 'FORM') return;
      event.preventDefault();
      event.stopPropagation();
      var act = button.dataset.qr;
      var id = button.dataset.id;
      if (isGuest() && act !== 'copy' && act !== 'share' && act !== 'host' && act !== 'download') return;
      if (isGuest() && (act === 'host' || act === 'download')) {
        if (handlers.onGuestPanel) handlers.onGuestPanel(act);
        return;
      }
      if (act === 'scan' && handlers.onScan) handlers.onScan();
      if (act === 'host' && handlers.onHost) handlers.onHost();
      if (act === 'download' && handlers.onDownload) handlers.onDownload();
      if (act === 'wlan' && handlers.onWlan) handlers.onWlan();
      if (act === 'hotspot' && handlers.onHotspot) handlers.onHotspot();
      if (act === 'copy' && handlers.onCopy) handlers.onCopy();
      if (act === 'share' && handlers.onShare) handlers.onShare();
      if (act === 'stop' && handlers.onStop) handlers.onStop();
      if (act === 'end-other') {
        if (busy) return;
        busy = true;
        pending = null;
        started = Date.now();
        shell();
        var bridge = window.OpenScrBridge || window.EveryAppBridge;
        var mp = bridge && bridge.multiplayer;
        var job = mp && mp.endRoom ? mp.endRoom() : Promise.resolve();
        Promise.resolve(job).then(function () {
          model.note = '';
          if (handlers.onHost) handlers.onHost();
        }, function (error) {
          pending = {
            open: 'host',
            hostLink: model.hostLink,
            note: (error && error.message) || 'Der alte Raum läuft noch.'
          };
          reveal();
        });
      }
      if (act === 'approve' && handlers.onApprove) handlers.onApprove(id);
      if (act === 'deny' && handlers.onDeny) handlers.onDeny(id);
    }, true);
    document.addEventListener('submit', function (event) {
      var form = event.target;
      if (!root || !form || !root.contains(form) || form.dataset.qr !== 'hotspot-show') return;
      event.preventDefault();
      event.stopPropagation();
      var ssid = root.querySelector('#oqr-ssid');
      var pass = root.querySelector('#oqr-pass');
      if (handlers.onHotspotShow) handlers.onHotspotShow({ ssid: ssid ? ssid.value : '', pass: pass ? pass.value : '' });
    }, true);
  }
  window.OpenScrQr = {
    attach: function (el, next) {
      install();
      root = el;
      handlers = next || {};
      bind();
    },
    setModel: function (next) {
      if (busy) {
        pending = next || {};
        if (root) shell();
        reveal();
        return;
      }
      var was = model.open;
      model = next || {};
      if (root) shell();
      if (!model.open && was !== '') openHostIfLive();
    }
  };
})();
`;
