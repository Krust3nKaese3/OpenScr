/** Bottom bar for browser guests. Same three icons as the OpenScr scrapp bar, for every mini-app. */
export const GUEST_SHELL_SOURCE = String.raw`
(function () {
  var page = 'index';
  var qr = { open: '', share: '', copied: false, note: '', image: '' };
  function guest() {
    var bridge = window.OpenScrBridge || window.EveryAppBridge;
    var flag = window.__OPEN_SCR_GUEST__;
    return !!(bridge && bridge.guest === true) || !!(flag && flag.room);
  }
  if (!guest()) return;
  var info = window.__OPEN_SCR_GUEST__ || {};
  function kind(name) {
    var lower = String(name || '').toLowerCase();
    if (lower.indexOf('wolf') >= 0 || lower.indexOf('wer') >= 0) return 'moon';
    if (lower.indexOf('dance') >= 0 || lower.indexOf('tanz') >= 0) return 'notes';
    if (lower.indexOf('song') >= 0 || lower.indexOf('musik') >= 0) return 'note';
    if (lower.indexOf('macro') >= 0) return 'bolt';
    if (lower.indexOf('demo') >= 0 || lower.indexOf('dice') >= 0 || lower.indexOf('würf') >= 0) return 'die';
    return 'notes';
  }
  var glyphs = {
    notes: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" d="M9 17V6l10-2v11"/><circle cx="7" cy="17" r="2.2" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="17" cy="15" r="2.2" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
    note: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" d="M9 17V5l9-2v12"/><circle cx="7" cy="17" r="2.2" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
    moon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.6" d="M16 3a8 8 0 1 0 5 14A9 9 0 0 1 16 3z"/></svg>',
    bolt: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" d="M13 2 4 14h7l-1 8 9-12h-7l1-8z"/></svg>',
    die: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="3" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="9" cy="9" r="1.1" fill="currentColor"/><circle cx="15" cy="15" r="1.1" fill="currentColor"/></svg>',
    qr: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="14" y="3" width="7" height="7" rx="1" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="3" y="14" width="7" height="7" rx="1" fill="none" stroke="currentColor" stroke-width="1.6"/><path fill="currentColor" d="M14 14h3v3h-3zM18 18h3v3h-3zM14 18h2v2h-2z"/></svg>',
    gear: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.6"/><path fill="none" stroke="currentColor" stroke-width="1.6" d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6"/></svg>'
  };
  var css = ''
    + 'body.openscr-guest-shell{padding-bottom:108px}'
    + '#openscr-guest-bar{position:fixed;left:0;right:0;bottom:22px;z-index:40;display:flex;justify-content:center;pointer-events:none}'
    + '#openscr-guest-bar .pill{pointer-events:auto;display:flex;gap:0;background:#141418;border:1px solid #2a2a32;border-radius:28px;padding:10px 8px}'
    + '#openscr-guest-bar button{width:56px;border:0;background:transparent;color:#a1a1aa;display:flex;flex-direction:column;align-items:center;padding:4px 0}'
    + '#openscr-guest-bar button.on{color:#A3E635}'
    + '#openscr-guest-bar svg{width:22px;height:22px}'
    + '#openscr-guest-bar i{display:block;margin-top:6px;height:2px;width:18px;border-radius:1px;background:transparent}'
    + '#openscr-guest-bar button.on i{background:#A3E635}'
    + '#openscr-guest-page{max-width:520px;margin:0 auto;padding:20px 16px 48px}'
    + '#openscr-guest-page h1{font-size:28px;margin:0 0 16px}'
    + '#openscr-guest-page h2{font-size:20px;margin:0}';
  function boot() {
    if (document.getElementById('openscr-guest-bar')) return;
    var style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    document.body.classList.add('openscr-guest-shell');
    var bar = document.createElement('div');
    bar.id = 'openscr-guest-bar';
    var name = info.name || document.title || 'OpenScrapp';
    bar.innerHTML = '<div class="pill">'
      + '<button type="button" data-page="index" aria-label="' + name.replace(/"/g, '') + '">' + glyphs[kind(name)] + '<i></i></button>'
      + '<button type="button" data-page="qr" aria-label="QR-Code">' + glyphs.qr + '<i></i></button>'
      + '<button type="button" data-page="options" aria-label="Optionen">' + glyphs.gear + '<i></i></button>'
      + '</div>';
    document.body.appendChild(bar);
    var host = document.createElement('div');
    host.id = 'openscr-guest-page';
    host.hidden = true;
    document.body.appendChild(host);
    bar.addEventListener('click', function (event) {
      var button = event.target.closest && event.target.closest('[data-page]');
      if (!button) return;
      show(button.getAttribute('data-page'));
    });
    window.addEventListener('openscr-shell', function (event) {
      event.stopImmediatePropagation();
      show(event.detail);
    }, true);
    mark();
  }
  function mark() {
    var buttons = document.querySelectorAll('#openscr-guest-bar [data-page]');
    for (var i = 0; i < buttons.length; i += 1) {
      buttons[i].classList.toggle('on', buttons[i].getAttribute('data-page') === page);
    }
  }
  function appNode() {
    return document.getElementById('app');
  }
  function show(next) {
    page = next === 'qr' || next === 'options' ? next : 'index';
    var app = appNode();
    var host = document.getElementById('openscr-guest-page');
    if (app) app.hidden = page !== 'index';
    if (host) host.hidden = page === 'index';
    mark();
    if (page === 'qr') paintQr();
    if (page === 'options' && host) {
      host.innerHTML = '<h1>' + (info.name || document.title || 'Optionen') + '</h1><h2>Optionen</h2>';
    }
  }
  function paintQr() {
    var host = document.getElementById('openscr-guest-page');
    if (!host || !window.OpenScrQr) return;
    host.innerHTML = '<h1>' + (info.name || document.title || '') + '</h1><div id="openscr-guest-qr"></div>';
    var el = document.getElementById('openscr-guest-qr');
    window.OpenScrQr.attach(el, {
      onGuestPanel: function (act) {
        if (act === 'download') fillDownload();
        else fillHost();
      },
      onCopy: function () {
        var text = qr.share || '';
        var done = function () { qr.copied = true; publishQr(); };
        if (navigator.clipboard && text) navigator.clipboard.writeText(text).then(done, done);
      },
      onShare: function () {
        var text = qr.share || '';
        if (navigator.share && text) navigator.share({ title: info.name || document.title || 'OpenScrapp', text: text }).catch(function () {});
      }
    });
    fillHost();
  }
  function fillHost() {
    qr.open = 'host';
    qr.copied = false;
    qr.share = String(location.href || '');
    qr.note = 'Link zum Mitspielen. Im selben WLAN öffnen.';
    publishQr();
    drawQr(qr.share);
  }
  function fillDownload() {
    qr.open = 'download';
    qr.copied = false;
    qr.share = info.repoUrl || '';
    qr.note = qr.share ? 'In OpenScr scannen, um die OpenScrapp zu laden.' : 'Der Download-Link fehlt auf diesem Gerät.';
    publishQr();
    drawQr(qr.share);
  }
  function publishQr() {
    if (!window.OpenScrQr) return;
    window.OpenScrQr.setModel({ viewer: 'guest', open: qr.open, share: qr.share, copied: qr.copied, note: qr.note, image: qr.image, requests: [] });
  }
  function drawQr(text) {
    var token = text;
    qr.image = '';
    if (!text || !window.OpenScrQrCode || typeof window.OpenScrQrCode.toString !== 'function') return;
    window.OpenScrQrCode.toString(text, { type: 'svg', margin: 1, width: 280, color: { dark: '#0B0B0F', light: '#FFFFFF' } }).then(function (svg) {
      if (qr.share !== token) return;
      qr.image = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      publishQr();
    }, function () {});
  }
  if (document.body) boot();
  else document.addEventListener('DOMContentLoaded', boot);
})();
`;
