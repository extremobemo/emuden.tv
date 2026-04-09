// N64 emulation — SEPARATE CODE PATH from the libretro/Worker architecture.
//
// N64 uses nbarkhina/N64Wasm — a completely different emulator that runs on the
// main thread with its own SDL/WebGL context. See CLAUDE.md for full details.

import { state, setState, shareCtx } from './state.js';
import { jsUpdateQuadColors } from './worker-bridge.js';
import { setStatus } from './utils.js';
import { initN64VirtualPads } from './virtual-gamepad.js';
import { buildN64Config, N64_PAD, N64_KB } from './n64-bindings.js';
import * as renderer from './renderer.js';
import {
  N64_AXIS_THRESHOLD, N64_AUDIO_RING, N64_AUDIO_BUFFER,
  N64_FRAME_W, N64_FRAME_H, GAMEPAD_EVENT_DELAY_MS,
  SHARE_CANVAS_W, SHARE_CANVAS_H, BUILD_DIR,
} from './config.js';

// rAF IDs for lifecycle management
let _copyLoopAnim = null;
let _axisPollAnim = null;

// Wrap n64wasm.js in an IIFE before injecting.
function loadN64Wasm(callback) {
  window._n64ModuleInit = {
    canvas: document.getElementById('n64canvas'),
    noInitialRun: true,
    locateFile: function(path) { return BUILD_DIR + path; },
  };
  fetch(BUILD_DIR + 'n64wasm.js')
    .then(function(r) { return r.text(); })
    .then(function(code) {
      const wrapped = '(function(){\nvar Module=window._n64ModuleInit||{};\n'
                    + code
                    + '\nif(typeof FS!=="undefined")Module.FS=FS;\n'
                    + 'if(typeof callMain!=="undefined")Module.callMain=callMain;\n'
                    + 'window._n64M=Module;\n})();';
      const blob = new Blob([wrapped], { type: 'application/javascript' });
      const url  = URL.createObjectURL(blob);
      const s = document.createElement('script');
      s.src = url;
      s.onerror = function() { setStatus('Failed to execute n64wasm.js'); };
      document.body.appendChild(s);
      (function check() {
        if (window._n64M && window._n64M.calledRun) {
          URL.revokeObjectURL(url);
          callback(window._n64M);
        } else {
          setTimeout(check, 100);
        }
      })();
    })
    .catch(function() { setStatus('Failed to fetch n64wasm.js'); });
}

// Translates a N64Wasm key string back to KeyboardEvent init properties.
function _n64KeyToProps(n64key) {
  const named = {
    Up: { key: 'ArrowUp',    code: 'ArrowUp'    },
    Down: { key: 'ArrowDown',  code: 'ArrowDown'  },
    Left: { key: 'ArrowLeft',  code: 'ArrowLeft'  },
    Right: { key: 'ArrowRight', code: 'ArrowRight' },
    Enter:  { key: 'Enter',   code: 'Enter'       },
    Space:  { key: ' ',       code: 'Space'       },
    LShift: { key: 'Shift',   code: 'ShiftLeft'   },
    RShift: { key: 'Shift',   code: 'ShiftRight'  },
    LCtrl:  { key: 'Control', code: 'ControlLeft' },
    RCtrl:  { key: 'Control', code: 'ControlRight'},
  };
  if (named[n64key]) return named[n64key];
  if (n64key.length === 1) return { key: n64key, code: 'Key' + n64key.toUpperCase() };
  return { key: n64key, code: n64key };
}

// Polls right-stick axes each frame and dispatches keyboard events when an
// axis-bound C-button crosses the threshold.
function _startN64AxisPoll() {
  const C_ACTIONS  = ['CUp', 'CDown', 'CLeft', 'CRight'];
  const _prev = {};

  (function poll() {
    if (!state.n64Running) { _axisPollAnim = null; return; }
    const gps = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp  = [...gps].find(g => g && g.connected && !g.id.startsWith('Virtual'));
    if (gp) {
      for (const action of C_ACTIONS) {
        const binding = N64_PAD[action];
        if (typeof binding !== 'string' || !binding.startsWith('axis:')) continue;
        const [, aStr, dStr] = binding.split(':');
        const val     = gp.axes[+aStr] || 0;
        const pressed = +dStr > 0 ? val > N64_AXIS_THRESHOLD : val < -N64_AXIS_THRESHOLD;
        if (pressed !== !!_prev[action]) {
          _prev[action] = pressed;
          const kbKey = N64_KB[action];
          if (kbKey) {
            const props = _n64KeyToProps(kbKey);
            document.dispatchEvent(new KeyboardEvent(
              pressed ? 'keydown' : 'keyup',
              { ...props, bubbles: true, cancelable: true }
            ));
          }
        }
      }
    }
    _axisPollAnim = requestAnimationFrame(poll);
  })();
}

// N64Wasm audio: reads resampled stereo Int16 audio from the WASM heap ring buffer.
function _startN64Audio(n64Mod, audioCtx) {
  const bufPtr = n64Mod._neilGetSoundBufferResampledAddress();
  const audioRing = new Int16Array(n64Mod.HEAP16.buffer, bufPtr, N64_AUDIO_RING);
  let readPos = 0;

  const node = audioCtx.createScriptProcessor(N64_AUDIO_BUFFER, 0, 2);
  node.onaudioprocess = function(ev) {
    const L = ev.outputBuffer.getChannelData(0);
    const R = ev.outputBuffer.getChannelData(1);
    const writePos = n64Mod._neilGetAudioWritePosition();

    for (let i = 0; i < L.length; i++) {
      if (readPos !== writePos) {
        L[i] = audioRing[readPos] / 32768;
        R[i] = audioRing[readPos + 1] / 32768;
        readPos = (readPos + 2) % N64_AUDIO_RING;
      } else {
        L[i] = R[i] = 0;
      }
    }
  };
  node.connect(audioCtx.destination);
}

export function loadN64(file) {
  if (state.n64Running) {
    if (!confirm('Loading another N64 ROM requires a page reload. Continue?')) return;
    location.reload();
    return;
  }
  // Stop any running libretro worker
  if (state.coreWorker) { state.coreWorker.terminate(); setState('coreWorker', null); }

  setStatus('Loading N64 emulator...');

  // Pre-create an AudioContext while the user gesture is still active.
  const _OrigAC = window.AudioContext || window.webkitAudioContext;
  let _n64AudioCtx;
  try { _n64AudioCtx = new _OrigAC({ sampleRate: 44100 }); _n64AudioCtx.resume(); } catch(e) {}

  // Stub out myApp so EM_ASM calls in n64wasm.js don't throw
  if (!window.myApp) window.myApp = {};
  window.myApp.localCallback = function() {};

  // Renderer is already loaded — set up game texture for N64 resolution
  renderer.getGameTexId();
  renderer.setFrameSize(N64_FRAME_W, N64_FRAME_H);

  loadN64Wasm(function(n64Mod) {
    setState('n64Module', n64Mod);

    setStatus('Loading ' + file.name + '...');
    const reader = new FileReader();
    reader.onload = function(ev) {
      const romBytes = new Uint8Array(ev.target.result);

      fetch(BUILD_DIR + 'assets.zip')
        .then(function(r) { return r.arrayBuffer(); })
        .then(function(assetsBuf) {
          const fs = state.n64Module.FS;
          fs.writeFile('assets.zip', new Uint8Array(assetsBuf));
          fs.writeFile('config.txt', buildN64Config());
          fs.writeFile('cheat.txt', '');
          fs.writeFile('custom.v64', romBytes);

          initN64VirtualPads();
          state.n64Module.callMain(['custom.v64']);
          setState('n64Running', true);

          if (_n64AudioCtx) _startN64Audio(n64Mod, _n64AudioCtx);
          _startN64AxisPoll();

          setTimeout(function() {
            [0, 1].forEach(function(i) {
              const pad = navigator.getGamepads()[i];
              if (pad) window.dispatchEvent(new GamepadEvent('gamepadconnected', { gamepad: pad }));
            });
          }, GAMEPAD_EVENT_DELAY_MS);

          setState('nowPlaying', file.name);
          setStatus(file.name);

          // Copy n64canvas → TV texture every frame via an intermediate 2D canvas.
          const n64canvas   = document.getElementById('n64canvas');
          const blitCanvas  = document.createElement('canvas');
          blitCanvas.width  = n64canvas.width;
          blitCanvas.height = n64canvas.height;
          const blit2d = blitCanvas.getContext('2d');

          const texId = renderer.getGameTexId();

          (function copyLoop() {
            if (state.n64Running) {
              const glTextures = renderer.getGLTextures();
              const gl = renderer.getGLContext();
              const tex = glTextures && glTextures[texId];
              if (tex && gl) {
                blit2d.drawImage(n64canvas, 0, 0);
                jsUpdateQuadColors(blitCanvas);
                gl.bindTexture(gl.TEXTURE_2D, tex);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, blitCanvas);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
                // Mirror to shareCanvas for WebRTC streaming
                shareCtx.drawImage(blitCanvas, 0, 0, SHARE_CANVAS_W, SHARE_CANVAS_H);
              }
            }
            _copyLoopAnim = requestAnimationFrame(copyLoop);
          })();
        })
        .catch(function() { setStatus('Failed to load assets.zip'); });
    };
    reader.readAsArrayBuffer(file);
  });
}

export function stopN64() {
  if (_copyLoopAnim !== null) { cancelAnimationFrame(_copyLoopAnim); _copyLoopAnim = null; }
  if (_axisPollAnim !== null) { cancelAnimationFrame(_axisPollAnim); _axisPollAnim = null; }
}
