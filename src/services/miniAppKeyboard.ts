// Runs inside every OpenScrapp page. The host shrinks the WebView above the keyboard; this script
// then makes sure the focused input is actually inside the visible part of the page.
export const MINI_APP_KEYBOARD_SOURCE = `(function(){
  if (window.__openscrKeyboardFix) return; window.__openscrKeyboardFix = true;
  var SKIP = /^(button|submit|reset|checkbox|radio|range|color|file|image)$/;
  function editable(el){
    if (!el || !el.tagName) return false;
    if (el.tagName === 'INPUT') return !SKIP.test(String(el.type || 'text').toLowerCase());
    return el.tagName === 'TEXTAREA' || el.isContentEditable === true;
  }
  function reveal(){
    var el = document.activeElement;
    if (!editable(el)) return;
    try {
      var r = el.getBoundingClientRect();
      var vh = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
      if (r.top < 8 || r.bottom > vh - 8) el.scrollIntoView({ block: 'center', inline: 'nearest' });
    } catch (e) {}
  }
  function later(){ setTimeout(reveal, 120); setTimeout(reveal, 450); }
  document.addEventListener('focusin', later, true);
  window.addEventListener('resize', later);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', later);
})();`;
