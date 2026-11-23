const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { stableWebViewHtml } = require('../src/services/webViewSource.ts');

test('webview html source stays the same object while the keyboard resizes', () => {
  const first = stableWebViewHtml(null, '<html>name</html>');
  const duringResize = stableWebViewHtml(first, '<html>name</html>');
  assert.strictEqual(duringResize, first);
  const nextDocument = stableWebViewHtml(duringResize, '<html>other</html>');
  assert.notStrictEqual(nextDocument, first);
  assert.strictEqual(nextDocument.html, '<html>other</html>');
});

test('the open scrapp does not subscribe to window size', () => {
  const runner = fs.readFileSync(path.join(__dirname, '../src/components/MiniAppRunner.tsx'), 'utf8');
  assert.ok(runner.includes('stableWebViewHtml'));
  assert.ok(!runner.includes('useWindowDimensions'));
});
