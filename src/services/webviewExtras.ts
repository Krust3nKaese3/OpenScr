/**
 * WebView-Teil für Audio und Dateiauswahl. Kein natives Modul.
 * Auf iOS wird der Text nicht eingesetzt.
 */
import { buildClip } from './audioClip';

export function webviewExtrasScript(): string {
  const build = buildClip.toString();
  return `
    (function () {
      function b64(bytes) {
        var alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
        var out = '';
        for (var i = 0; i < bytes.length; i += 3) {
          var a = bytes[i];
          var b = i + 1 < bytes.length ? bytes[i + 1] : 0;
          var c = i + 2 < bytes.length ? bytes[i + 2] : 0;
          var n = (a << 16) | (b << 8) | c;
          out += alphabet[(n >> 18) & 63] + alphabet[(n >> 12) & 63];
          out += i + 1 < bytes.length ? alphabet[(n >> 6) & 63] : '=';
          out += i + 2 < bytes.length ? alphabet[n & 63] : '=';
        }
        return out;
      }
      window.__openscrBytesToBase64 = function (value) {
        var bytes = value instanceof Uint8Array ? value : new Uint8Array(value || []);
        return b64(bytes);
      };
      window.__openscrBase64ToBytes = function (value) {
        var bin = atob(value || '');
        var out = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) & 255;
        return out;
      };
      var bridge = window.OpenScrBridge;
      if (!bridge) return;
      function toU8(value) {
        if (!value) return new Uint8Array();
        if (value instanceof Uint8Array) return value;
        if (Array.isArray(value)) return new Uint8Array(value);
        if (typeof value === 'string') {
          var bin = atob(value);
          var out = new Uint8Array(bin.length);
          for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) & 255;
          return out;
        }
        if (value.buffer) return new Uint8Array(value.buffer, value.byteOffset || 0, value.byteLength || value.buffer.byteLength);
        return new Uint8Array();
      }
      var buildClip = ${build};
      var playTimer = null;
      var playNode = null;
      bridge.files = {
        pickAudio: function (opts) {
          opts = opts || {};
          return new Promise(function (resolve) {
            var input = document.createElement('input');
            input.type = 'file';
            input.accept = (opts.accept && opts.accept.length) ? opts.accept.join(',') : 'audio/*';
            input.multiple = !!opts.multiple;
            input.onchange = function () {
              var files = Array.prototype.slice.call(input.files || []);
              Promise.all(files.map(function (file) {
                return file.arrayBuffer().then(function (buf) {
                  var bytes = new Uint8Array(buf);
                  var durationMs = 0;
                  var Ctx = window.AudioContext || window.webkitAudioContext;
                  if (!Ctx) return { name: file.name, mime: file.type || 'application/octet-stream', bytes: bytes, durationMs: 0 };
                  var ctx = new Ctx();
                  return ctx.decodeAudioData(bytes.buffer.slice(0)).then(function (audio) {
                    durationMs = Math.round(audio.duration * 1000);
                    ctx.close();
                    return { name: file.name, mime: file.type || 'application/octet-stream', bytes: bytes, durationMs: durationMs };
                  }).catch(function () {
                    try { ctx.close(); } catch (err) {}
                    return { name: file.name, mime: file.type || 'application/octet-stream', bytes: bytes, durationMs: 0 };
                  });
                });
              })).then(resolve);
            };
            input.click();
          });
        }
      };
      bridge.audio = {
        cut: function (opts) {
          opts = opts || {};
          var bytes = toU8(opts.bytes);
          var Ctx = window.AudioContext || window.webkitAudioContext;
          if (!Ctx) return Promise.reject(new Error('AudioContext fehlt in dieser WebView.'));
          var ctx = new Ctx();
          var copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
          return ctx.decodeAudioData(copy).then(function (audio) {
            var channel = audio.getChannelData(0);
            var durationMs = opts.durationMs == null ? 10000 : opts.durationMs;
            var clip = buildClip(channel, audio.sampleRate, opts.startMs || 0, durationMs, opts.targetBytes);
            ctx.close();
            return { bytes: clip, durationMs: durationMs, byteLength: clip.length };
          }).catch(function (error) {
            try { ctx.close(); } catch (err) {}
            throw error;
          });
        },
        speak: function () {
          return Promise.reject(new Error('Sprachausgabe braucht ein natives Modul und ist in diesem Build nicht enthalten.'));
        },
        schedulePlay: function (opts) {
          opts = opts || {};
          var bytes = toU8(opts.bytes);
          var Ctx = window.AudioContext || window.webkitAudioContext;
          if (!Ctx) return Promise.reject(new Error('AudioContext fehlt in dieser WebView.'));
          var ctx = new Ctx();
          function startBuffer(audioBuffer) {
            var wait = Math.max(0, (opts.startAtMs || Date.now()) - Date.now());
            return new Promise(function (resolve) {
              playTimer = setTimeout(function () {
                var src = ctx.createBufferSource();
                playNode = src;
                src.buffer = audioBuffer;
                src.connect(ctx.destination);
                src.start();
                if (opts.durationMs) src.stop(ctx.currentTime + opts.durationMs / 1000);
                resolve({ started: true });
              }, wait);
            });
          }
          if (bytes.length >= 4 && bytes[0] === 0x4d && bytes[1] === 0x55 && bytes[2] === 0x4c && bytes[3] === 0x57) {
            var pcm = mulawToFloat(bytes.subarray(12));
            var buffer = ctx.createBuffer(1, pcm.length, 16000);
            buffer.getChannelData(0).set(pcm);
            return startBuffer(buffer);
          }
          return ctx.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)).then(startBuffer);
        },
        stop: function () {
          if (playTimer) clearTimeout(playTimer);
          playTimer = null;
          if (playNode) { try { playNode.stop(); } catch (err) {} }
          playNode = null;
          return Promise.resolve({ stopped: true });
        }
      };
      bridge.clock = {
        sync: function () {
          var offset = 0;
          return Promise.resolve({
            offsetMs: offset,
            now: function () { return Date.now() + offset; }
          });
        }
      };
      function mulawToFloat(bytes) {
        var out = new Float32Array(bytes.length);
        for (var i = 0; i < bytes.length; i++) {
          var value = (~bytes[i]) & 255;
          var sign = value & 0x80;
          var exponent = (value >> 4) & 7;
          var mantissa = value & 0x0f;
          var sample = ((mantissa << 3) + 132) << exponent;
          sample -= 132;
          out[i] = (sign ? -sample : sample) / 32768;
        }
        return out;
      }
    })();
  `;
}
