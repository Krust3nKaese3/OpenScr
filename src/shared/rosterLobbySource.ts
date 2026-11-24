/** Lobby screen shared by Songraten and Werwolf. Injected into every mini-app. */
export const ROSTER_LOBBY_SOURCE = String.raw`
(function () {
  var css = ''
    + '.orl{display:flex;flex-direction:column;gap:14px;color:#f4f4f5;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}'
    + '.orl button,.orl input{font:inherit;color:inherit}'
    + '.orl input{width:100%;min-height:52px;border-radius:16px;border:1px solid rgba(255,255,255,.08);background:#1c1c22;padding:12px 14px}'
    + '.orl-btn{min-height:52px;border:0;border-radius:999px;background:#A3E635;color:#111;font-weight:750;padding:12px 16px}'
    + '.orl button.orl-btn{color:#111}'
    + '.orl button.orl-btn.secondary,.orl button.orl-btn.ghost{color:#f4f4f5}'
    + '.orl-btn:disabled{opacity:.45}'
    + '.orl-btn.secondary{background:transparent;color:#f4f4f5;border:1px solid rgba(255,255,255,.16)}'
    + '.orl-btn.ghost{background:#1c1c22;color:#f4f4f5}'
    + '.orl-link{background:transparent;border:0;color:#d4d4d8;min-height:44px;font-weight:650}'
    + '.orl-suggest{background:#17171c;border-radius:16px;overflow-x:hidden;overflow-y:auto;max-height:260px;touch-action:none;overscroll-behavior:contain}'
    + '.orl-suggest:empty{display:none}'
    + '.orl-choice{width:100%;text-align:left;min-height:52px;border:0;border-bottom:1px solid rgba(255,255,255,.05);background:transparent;padding:12px 14px;display:flex;align-items:center;touch-action:none}'
    + '.orl-choice.pressed,.orl-x.pressed{background:rgba(163,230,53,.22)}'
    + '.orl-row{display:flex;align-items:stretch;border-bottom:1px solid rgba(255,255,255,.05)}'
    + '.orl-row .orl-choice{flex:1;border-bottom:0}'
    + '.orl-row.in{box-shadow:inset 0 0 0 2px #A3E635}'
    + '.orl-suggest>:first-child{border-top-left-radius:16px;border-top-right-radius:16px;overflow:hidden}'
    + '.orl-suggest>:last-child{border-bottom-left-radius:16px;border-bottom-right-radius:16px;overflow:hidden}'
    + '.orl-x{width:44px;flex:0 0 44px;border:0;background:transparent;color:#d4d4d8;touch-action:none}'
    + '.orl-x.pressed{color:#A3E635}'
    + '.orl-hit{color:#A3E635;font-weight:750}'
    + '.orl-roster{display:flex;flex-direction:row;flex-wrap:wrap;gap:8px}'
    + '.orl-roster:empty{display:none}'
    + '.orl-roles{display:flex;flex-direction:row;flex-wrap:wrap;gap:8px}'
    + '.orl-roles:empty{display:none}'
    + '.orl-role{display:inline-flex;align-items:center;gap:2px;min-height:44px;padding:4px 4px 4px 10px;border-radius:999px;background:#1c1c22}'
    + '.orl-role-main{border:0;background:transparent;min-width:36px;min-height:36px;font-size:22px;line-height:1;padding:0 4px}'
    + '.orl-info{width:32px;height:32px;border:0;border-radius:999px;background:transparent;color:#d4d4d8;font-weight:750}'
    + '.orl-role-main.pressed,.orl-info.pressed{background:rgba(163,230,53,.22);color:#A3E635}'
    + '.orl-modal{position:fixed;inset:0;z-index:50;display:flex;align-items:center;justify-content:center;padding:18px;background:rgba(0,0,0,.62)}'
    + '.orl-modal[hidden]{display:none}'
    + '.orl-sheet{width:min(340px,100%);background:#17171c;border-radius:20px;padding:18px;display:flex;flex-direction:column;gap:8px}'
    + '.orl-sheet .emoji{font-size:40px;line-height:1;margin:0}'
    + '.orl-sheet h2{margin:0;font-size:22px}'
    + '.orl-sheet p{margin:0;color:#d4d4d8;line-height:1.35}'
    + '.orl-team{color:#A3E635;font-weight:700}'
    + '.orl-person{display:inline-flex;align-items:center;gap:4px;width:auto;max-width:100%;min-height:44px;padding:4px 4px 4px 12px;border-radius:999px;background:#1c1c22}'
    + '.orl-person .orl-x{width:32px;flex-basis:32px;border-radius:999px}'
    + '.orl details{color:#a1a1aa}'
    + '.orl summary{min-height:44px;display:flex;align-items:center;font-weight:700;color:#f4f4f5}'
    + '.orl-card{background:#17171c;border:1px solid rgba(255,255,255,.06);border-radius:18px;padding:14px}';

  var root = null;
  var handlers = {};
  var model = { directory: [], seated: [], roles: [], query: '', startLabel: 'Spiel starten', startDisabled: true, statsLabel: 'Statistik', rulesHtml: '' };
  var creating = false;
  var bound = false;
  var moved = false;
  var press = null;

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch];
    });
  }
  function norm(value) {
    return String(value || '').trim().toLocaleLowerCase();
  }
  function seatedMatch(entry) {
    var id = String(entry.id);
    var label = norm(entry.label);
    var found = null;
    (model.seated || []).some(function (seat) {
      if (String(seat.pid || '') === id || norm(seat.label) === label) { found = seat; return true; }
      return false;
    });
    return found;
  }
  function hits() {
    var needle = norm(model.query);
    return (model.directory || []).filter(function (entry) {
      if (!needle) return true;
      return norm(entry.label).indexOf(needle) >= 0;
    }).slice(0, 30);
  }
  function labelHtml(label) {
    var full = String(label || '');
    var needle = String(model.query || '').trim();
    var at = needle ? full.toLocaleLowerCase().indexOf(needle.toLocaleLowerCase()) : -1;
    if (at < 0) return esc(full);
    return esc(full.slice(0, at)) + '<span class="orl-hit">' + esc(full.slice(at, at + needle.length)) + '</span>' + esc(full.slice(at + needle.length));
  }
  function install() {
    if (document.getElementById('openscr-roster-style')) return;
    var style = document.createElement('style');
    style.id = 'openscr-roster-style';
    style.textContent = css;
    document.head.appendChild(style);
  }
  function field() { return root && root.querySelector('#orl-name'); }

  function paintSuggest() {
    var box = root.querySelector('.orl-suggest');
    if (!box) return;
    var active = document.activeElement && document.activeElement.id === 'orl-name';
    box.replaceChildren();
    if (!active) return;
    hits().forEach(function (entry) {
      var seat = seatedMatch(entry);
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'orl-choice';
      button.dataset.act = 'pick';
      button.dataset.id = entry.id;
      if (seat) button.dataset.seated = '1';
      button.innerHTML = labelHtml(entry.label);
      button.addEventListener('mousedown', function (event) { event.preventDefault(); });
      if (!seat) { box.appendChild(button); return; }
      var row = document.createElement('div');
      row.className = 'orl-row in';
      var remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'orl-x';
      remove.dataset.act = 'drop';
      remove.dataset.id = seat.id;
      remove.setAttribute('aria-label', entry.label + ' entfernen');
      remove.textContent = '✕';
      remove.addEventListener('mousedown', function (event) { event.preventDefault(); });
      row.append(button, remove);
      box.appendChild(row);
    });
  }
  function paintPeople() {
    var box = root.querySelector('.orl-roster');
    if (!box) return;
    box.innerHTML = (model.seated || []).map(function (seat) {
      return '<div class="orl-person"><span>' + esc(seat.label) + '</span><button type="button" class="orl-x" data-act="drop" data-id="' + esc(seat.id) + '" aria-label="' + esc(seat.label) + ' entfernen">✕</button></div>';
    }).join('');
    var start = root.querySelector('[data-act="start"]');
    if (start) start.disabled = !!model.startDisabled;
    paintRoles();
  }
  function paintRoles() {
    var box = root.querySelector('.orl-roles');
    if (!box) return;
    box.innerHTML = (model.roles || []).map(function (role) {
      return '<div class="orl-role"><button type="button" class="orl-role-main" data-act="role" data-id="' + esc(role.id) + '" aria-label="' + esc(role.name) + '">' + role.emoji + '</button><button type="button" class="orl-info" data-act="role" data-id="' + esc(role.id) + '" aria-label="Erklärung ' + esc(role.name) + '">i</button></div>';
    }).join('');
  }
  function openRole(id) {
    var role = null;
    (model.roles || []).some(function (item) { if (item.id === id) { role = item; return true; } return false; });
    var modal = root.querySelector('.orl-modal');
    if (!modal || !role) return;
    modal.hidden = false;
    modal.querySelector('.emoji').textContent = role.emoji || '';
    modal.querySelector('h2').textContent = role.name || '';
    modal.querySelector('.orl-team').textContent = role.team ? ('Team ' + role.team) : '';
    modal.querySelector('.orl-text').textContent = role.text || '';
  }
  function shell() {
    var create = creating
      ? '<form class="orl" data-act="create"><input id="orl-first" maxlength="16" placeholder="Anzeigename" aria-label="Anzeigename" autocomplete="off"><input id="orl-tag" maxlength="5" placeholder="Tag" aria-label="Tag" autocomplete="off" autocapitalize="characters"><button class="orl-btn" type="submit">Speichern und hinzufügen</button><button type="button" class="orl-btn ghost" data-act="cancel">Zurück</button></form>'
      : '<button type="button" class="orl-btn secondary" data-act="new">Neue Person</button>';
    root.innerHTML = '<div class="orl">'
      + '<input id="orl-name" maxlength="80" placeholder="Name eingeben" aria-label="Name suchen" autocomplete="off" autocapitalize="words" value="' + esc(model.query) + '">'
      + '<div class="orl-suggest"></div>'
      + create
      + '<div class="orl-roster"></div>'
      + '<div class="orl-roles"></div>'
      + '<button type="button" class="orl-btn" data-act="start"' + (model.startDisabled ? ' disabled' : '') + '>' + esc(model.startLabel || 'Spiel starten') + '</button>'
      + '<button type="button" class="orl-link" data-act="stats">' + esc(model.statsLabel || 'Statistik') + '</button>'
      + '<div class="orl-card">' + (model.rulesHtml || '') + '</div>'
      + '<div class="orl-modal" hidden><div class="orl-sheet" role="dialog" aria-modal="true"><p class="emoji"></p><h2></h2><p class="orl-team"></p><p class="orl-text"></p><button type="button" class="orl-btn" data-act="role-close">Schließen</button></div></div>'
      + '</div>';
    var input = field();
    if (input) input.addEventListener('input', function () {
      model.query = input.value;
      if (handlers.onQuery) handlers.onQuery(input.value);
      paintSuggest();
    });
    if (input) input.addEventListener('focus', paintSuggest);
    if (input) input.addEventListener('focusout', function (event) {
      var next = event.relatedTarget;
      if (next && next.closest && next.closest('.orl-suggest')) return;
      var box = root.querySelector('.orl-suggest');
      if (box) box.replaceChildren();
    });
    paintPeople();
  }
  function bind() {
    if (bound) return;
    bound = true;
    document.addEventListener('pointerdown', function (event) {
      if (!root || !root.contains(event.target)) return;
      var button = event.target.closest && event.target.closest('[data-act="pick"],[data-act="drop"],[data-act="role"]');
      press = button || null;
      moved = false;
      if (button) button.classList.add('pressed');
    });
    document.addEventListener('pointerup', function () {
      var button = press;
      press = null;
      if (!button || moved || !root || !root.contains(button)) return;
      var act = button.dataset.act;
      if (act === 'pick' && button.dataset.seated === '1') {
        setTimeout(function () { button.classList.remove('pressed'); }, 160);
        return;
      }
      if (act === 'pick' && handlers.onPick) handlers.onPick(button.dataset.id);
      if (act === 'drop') {
        setTimeout(function () {
          if (handlers.onRemove) handlers.onRemove(button.dataset.id);
        }, 140);
        return;
      }
      if (act === 'role') {
        openRole(button.dataset.id);
        setTimeout(function () { button.classList.remove('pressed'); }, 160);
      }
    });
    document.addEventListener('touchstart', function (event) {
      if (!root || !event.target.closest || !event.target.closest('.orl-suggest')) return;
      root._y = event.touches[0].clientY;
      moved = false;
    }, { passive: true });
    document.addEventListener('touchmove', function (event) {
      var box = root && event.target.closest && event.target.closest('.orl-suggest');
      if (!box || !event.touches.length) return;
      var y = event.touches[0].clientY;
      var dy = (root._y || y) - y;
      if (Math.abs(dy) > 8) {
        moved = true;
        if (press) press.classList.remove('pressed');
      }
      root._y = y;
      box.scrollTop += dy;
      if (event.cancelable) event.preventDefault();
    }, { passive: false });
    document.addEventListener('click', function (event) {
      if (!root || !root.contains(event.target)) return;
      if (event.target.classList && event.target.classList.contains('orl-modal')) {
        event.target.hidden = true;
        return;
      }
      var button = event.target.closest && event.target.closest('[data-act]');
      if (!button) return;
      var act = button.dataset.act;
      if (act === 'pick' || act === 'drop' || act === 'role') { event.preventDefault(); event.stopPropagation(); return; }
      event.preventDefault();
      event.stopPropagation();
      if (act === 'new') { creating = true; shell(); }
      if (act === 'cancel') { creating = false; shell(); }
      if (act === 'start' && handlers.onStart) handlers.onStart();
      if (act === 'stats' && handlers.onStats) handlers.onStats();
      if (act === 'role-close') {
        var modal = root.querySelector('.orl-modal');
        if (modal) modal.hidden = true;
      }
    }, true);
    document.addEventListener('submit', function (event) {
      var form = event.target;
      if (!root || !form || !root.contains(form) || form.dataset.act !== 'create') return;
      event.preventDefault();
      event.stopPropagation();
      var name = root.querySelector('#orl-first');
      var tag = root.querySelector('#orl-tag');
      creating = false;
      if (handlers.onCreate) handlers.onCreate({ name: name ? name.value : '', tag: tag ? tag.value : '' });
    }, true);
  }

  window.OpenScrRoster = {
    attach: function (el, next) {
      install();
      root = el;
      handlers = next || {};
      bind();
      shell();
    },
    setModel: function (next) {
      model = next || model;
      if (!root) return;
      var input = field();
      if (input && document.activeElement === input) {
        if (input.value !== String(model.query || '')) input.value = model.query || '';
        paintSuggest();
        paintPeople();
        paintRoles();
        return;
      }
      shell();
    }
  };
})();
`;
