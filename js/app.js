// Entry point: canvas setup, renderer loading, ROM dispatch, slider wiring,
// BIOS/save file loading, and core readiness status checks.

import { state } from './state.js';
import { setStatus } from './utils.js';
import { spawnCoreWorker, setBiosFile, ps1BiosLoaded, setSaturnBiosFile, saturnBiosLoaded } from './worker-bridge.js';
import { loadN64 } from './n64.js';
import { mpHost, mpJoin, broadcastScene } from './multiplayer.js';
import { initInput, GAME_MAP, setKeyBinding, resetBindings, PAD_GAME_MAP, setPadBinding, resetPadBindings, setActiveGamepad } from './input.js';
import { N64_BINDABLE, N64_KB_ONLY, N64_KB, N64_PAD, setN64KbBinding, setN64PadBinding, resetN64KbBindings, resetN64PadBindings } from './n64-bindings.js';

// ── Canvas sizing ─────────────────────────────────────────────
const canvas = document.getElementById('canvas');

(function sizeCanvas() {
  const pad = 80;
  const maxW = Math.round(window.innerWidth * 0.75);
  const maxH = window.innerHeight - pad;
  const aspect = 16 / 9;
  let w = maxW, h = Math.round(maxW / aspect);
  if (h > maxH) { h = maxH; w = Math.round(h * aspect); }
  canvas.width  = w;
  canvas.height = h;
  // Lock dimensions — n64wasm's SDL fires resize events that would otherwise
  // shrink this canvas to N64 native resolution.
  Object.defineProperty(canvas, 'width',  { get: () => w, set: () => {} });
  Object.defineProperty(canvas, 'height', { get: () => h, set: () => {} });
})();

// ── Global error display ──────────────────────────────────────
window.onerror = function(msg, src, line) {
  setStatus('JS error: ' + msg + ' (' + (src || '').split('/').pop() + ':' + line + ')');
};

// ── Core routing ──────────────────────────────────────────────
const CORE_MAP = {
  'gb':  'core_gbc.js',
  'gbc': 'core_gbc.js',
  'gba': 'core_gba.js',
  'sfc': 'core_snes.js',
  'smc': 'core_snes.js',
  'fig': 'core_snes.js',
  'swc': 'core_snes.js',
  'bs':  'core_snes.js',
  'iso': 'core_saturn.js',
  'ccd': 'core_saturn.js',
};
// Extensions shared between PS1 and Saturn — trigger a system picker
const DISC_EXTS = new Set(['bin', 'cue', 'chd', 'img']);
const N64_EXTS = new Set(['z64', 'n64', 'v64']);

// ── Renderer loader ───────────────────────────────────────────
// Inject a <script> tag and poll until window.Module.calledRun is true.
// Used for game_renderer.js (main thread Emscripten bundle).
function injectAndWait(src, onReady, onError) {
  const s = document.createElement('script');
  s.src = src;
  s.onerror = function() {
    setStatus('Failed to load ' + src);
    if (onError) onError();
  };
  document.body.appendChild(s);
  function check() {
    if (window.Module && window.Module.calledRun) {
      onReady(window.Module);
    } else {
      setTimeout(check, 100);
    }
  }
  setTimeout(check, 200);
}

// ── Slider wiring ─────────────────────────────────────────────
function applyRoomXform() {
  if (!state.rendererModule) return;
  const scale = parseFloat(document.getElementById('room-scale').value);
  const rotY  = parseFloat(document.getElementById('room-roty').value) || 0;
  const tx    = parseFloat(document.getElementById('room-tx').value)   || 0;
  const ty    = parseFloat(document.getElementById('room-ty').value)   || 0;
  const tz    = parseFloat(document.getElementById('room-tz').value)   || 0;
  document.getElementById('room-scale-val').textContent = scale;
  state.rendererModule.ccall('set_room_xform', null,
    ['number','number','number','number','number'], [scale, rotY, tx, ty, tz]);
}
['room-scale','room-roty','room-tx','room-ty','room-tz'].forEach(function(id) {
  document.getElementById(id).addEventListener('input', applyRoomXform);
});

function applyOverscan() {
  if (!state.rendererModule) return;
  const x = parseFloat(document.getElementById('overscan-x').value);
  const y = parseFloat(document.getElementById('overscan-y').value);
  state.rendererModule.ccall('set_overscan', null, ['number','number'], [x, y]);
}
document.getElementById('overscan-x').addEventListener('input', applyOverscan);
document.getElementById('overscan-y').addEventListener('input', applyOverscan);

function applyLampPos() {
  if (!state.rendererModule) return;
  const x = parseFloat(document.getElementById('lamp-x').value) || 0;
  const y = parseFloat(document.getElementById('lamp-y').value) || 0;
  const z = parseFloat(document.getElementById('lamp-z').value) || 0;
  state.rendererModule.ccall('set_lamp_pos', null, ['number','number','number'], [x, y, z]);
}
['lamp-x','lamp-y','lamp-z'].forEach(function(id) {
  document.getElementById(id).addEventListener('input', applyLampPos);
});

function applyLampIntensity() {
  if (!state.rendererModule) return;
  const v = parseFloat(document.getElementById('lamp-intensity').value);
  document.getElementById('lamp-intensity-val').textContent = v;
  state.rendererModule.ccall('set_lamp_intensity', null, ['number'], [v]);
}
document.getElementById('lamp-intensity').addEventListener('input', applyLampIntensity);

function applyTvIntensity() {
  if (!state.rendererModule) return;
  const v = parseFloat(document.getElementById('tv-intensity').value);
  document.getElementById('tv-intensity-val').textContent = v;
  state.rendererModule.ccall('set_tv_light_intensity', null, ['number'], [v]);
}
document.getElementById('tv-intensity').addEventListener('input', applyTvIntensity);

function applyConeParams() {
  if (!state.rendererModule) return;
  state.rendererModule.ccall('set_cone_yaw',   null, ['number'],
    [parseFloat(document.getElementById('cone-yaw').value)]);
  state.rendererModule.ccall('set_cone_pitch', null, ['number'],
    [parseFloat(document.getElementById('cone-pitch').value)]);
  state.rendererModule.ccall('set_cone_power', null, ['number'],
    [parseFloat(document.getElementById('cone-power').value)]);
}
['cone-yaw','cone-pitch','cone-power'].forEach(id =>
  document.getElementById(id).addEventListener('input', applyConeParams));

document.getElementById('my-y').addEventListener('input', function() {
  if (!state.rendererModule) return;
  state.rendererModule.ccall('set_local_y', null, ['number'], [parseFloat(this.value)]);
});

document.getElementById('cat-eye-height').addEventListener('input', function() {
  if (!state.rendererModule) return;
  state.rendererModule.ccall('set_cat_eye_height', null, ['number'], [parseFloat(this.value)]);
});

document.getElementById('player-model').addEventListener('change', function() {
  state.localModel = parseInt(this.value);
});

document.getElementById('local-name').addEventListener('input', function() {
  state.localName = this.value.trim().slice(0, 20);
});

// ── Core readiness checks ─────────────────────────────────────
let _ps1CoreAvailable = false;

function setCoreIcon(id, ok, note) {
  const icon = document.getElementById('core-icon-' + id);
  if (icon) icon.textContent = ok ? '✅' : '❌';
  if (note !== undefined) {
    const noteEl = document.getElementById('core-note-' + id);
    if (noteEl) noteEl.textContent = note;
  }
}

function checkCores() {
  // Simple cores — just check file presence
  ['gbc', 'gba', 'snes'].forEach(function(id) {
    fetch('core_' + id + '.js', { method: 'HEAD' })
      .then(function(r) { setCoreIcon(id, r.ok); })
      .catch(function()  { setCoreIcon(id, false); });
  });

  // PS1 — requires BIOS; track availability for the BIOS upload handler
  fetch('core_ps1.js', { method: 'HEAD' })
    .then(function(r) {
      _ps1CoreAvailable = r.ok;
      setCoreIcon('ps1', false, r.ok ? '(needs BIOS)' : '(file missing)');
    })
    .catch(function() { _ps1CoreAvailable = false; setCoreIcon('ps1', false, '(file missing)'); });

  // Saturn — requires BIOS
  fetch('core_saturn.js', { method: 'HEAD' })
    .then(function(r) { setCoreIcon('saturn', false, r.ok ? '(needs BIOS)' : '(file missing)'); })
    .catch(function() { setCoreIcon('saturn', false, '(file missing)'); });

  // N64 needs both the JS bundle and assets.zip
  Promise.all([
    fetch('n64wasm.js', { method: 'HEAD' }).then(r => r.ok).catch(() => false),
    fetch('assets.zip', { method: 'HEAD' }).then(r => r.ok).catch(() => false),
  ]).then(function([wasm, assets]) {
    if (wasm && assets) { setCoreIcon('n64', true); }
    else { setCoreIcon('n64', false, wasm ? '(missing assets.zip)' : '(file missing)'); }
  });
}

checkCores();

// ── File inputs ───────────────────────────────────────────────
document.getElementById('bios-input').addEventListener('change', function(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(ev) {
    setBiosFile(file.name, new Uint8Array(ev.target.result));
    if (_ps1CoreAvailable) setCoreIcon('ps1', true, '');
    setStatus('BIOS ready: ' + file.name + ' — now load a PS1 disc');
  };
  reader.readAsArrayBuffer(file);
});

document.getElementById('saturn-bios-input').addEventListener('change', function(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(ev) {
    setSaturnBiosFile(new Uint8Array(ev.target.result));
    setCoreIcon('saturn', true, '');
    setStatus('Saturn BIOS ready: ' + file.name + ' — now load a Saturn disc');
  };
  reader.readAsArrayBuffer(file);
});


document.getElementById('rom-input').addEventListener('change', function(e) {
  const file = e.target.files[0];
  if (!file) return;
  const ext = file.name.split('.').pop().toLowerCase();

  if (N64_EXTS.has(ext)) {
    loadN64(file);
    return;
  }

  if (DISC_EXTS.has(ext)) {
    _discPickerFile = file;
    _discPickerExt  = ext;
    document.getElementById('disc-prompt').classList.remove('hidden');
    return;
  }

  const bundle = CORE_MAP[ext];
  if (!bundle) {
    setStatus('Unsupported format: .' + ext);
    return;
  }

  if (bundle === 'core_saturn.js' && !saturnBiosLoaded) {
    setStatus('Load a Saturn BIOS (.bin) first via Settings, then reload your disc');
    return;
  }

  spawnCoreWorker(bundle, file, ext);
});

// ── Disc system picker ────────────────────────────────────────
let _discPickerFile = null;
let _discPickerExt  = null;

function _launchDisc(bundle) {
  document.getElementById('disc-prompt').classList.add('hidden');
  const file = _discPickerFile;
  const ext  = _discPickerExt;
  _discPickerFile = null;
  _discPickerExt  = null;
  spawnCoreWorker(bundle, file, ext);
}

const _discSystems = [
  { id: 'disc-pick-ps1',    bundle: 'core_ps1.js',    biosCheck: () => ps1BiosLoaded,    biosMsg: 'Load a PS1 BIOS (.bin) first, then reload your disc' },
  { id: 'disc-pick-saturn', bundle: 'core_saturn.js', biosCheck: () => saturnBiosLoaded, biosMsg: 'Load a Saturn BIOS (.bin) first via Settings, then reload your disc' },
];
_discSystems.forEach(function({ id, bundle, biosCheck, biosMsg }) {
  document.getElementById(id).addEventListener('click', function() {
    if (!biosCheck()) {
      document.getElementById('disc-prompt').classList.add('hidden');
      setStatus(biosMsg);
      return;
    }
    _launchDisc(bundle);
  });
});

// ── Screen state machine ──────────────────────────────────────
const CHAR_NAMES = ['Cat', 'Incidental 70', 'Mech', 'Knight'];
let _carouselIdx   = 0;
let _pendingIsHost = false;
let _pendingHostId = null;


function showScreen(name) {
  ['landing-screen', 'carousel-screen', 'carousel-controls', 'join-prompt',
   'ui', 'mp-bar', 'settings-btn', 'controls-btn'].forEach(function(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  });
  if (name === 'landing') {
    document.getElementById('landing-screen').classList.remove('hidden');
  } else if (name === 'carousel') {
    document.getElementById('carousel-screen').classList.remove('hidden');
    document.getElementById('carousel-controls').classList.remove('hidden');
  } else if (name === 'room') {
    ['ui', 'mp-bar', 'settings-btn', 'controls-btn', 'overlay'].forEach(function(id) {
      document.getElementById(id).classList.remove('hidden');
    });
  }
}

function updateCarouselDisplay() {
  document.getElementById('carousel-char-name').textContent = CHAR_NAMES[_carouselIdx];
  if (state.rendererModule)
    state.rendererModule.ccall('set_preview_mode', null, ['number'], [_carouselIdx]);
}

function openCarousel() {
  _carouselIdx = 0;
  loadRenderer();
  updateCarouselDisplay();
  showScreen('carousel');
  if (state.rendererModule)
    state.rendererModule.ccall('set_preview_mode', null, ['number'], [_carouselIdx]);
}

function showJoinPrompt() {
  document.getElementById('join-prompt').classList.remove('hidden');
  document.getElementById('join-hostid').value = '';
  document.getElementById('join-prompt-status').textContent = '';
  document.getElementById('join-hostid').focus();
}

// Landing buttons
document.getElementById('btn-landing-host').addEventListener('click', function() {
  _pendingIsHost = true;
  openCarousel();
});
document.getElementById('btn-landing-join').addEventListener('click', function() {
  _pendingIsHost = false;
  showJoinPrompt();
});

// Carousel arrows
document.getElementById('carousel-prev').addEventListener('click', function() {
  _carouselIdx = (_carouselIdx + CHAR_NAMES.length - 1) % CHAR_NAMES.length;
  updateCarouselDisplay();
});
document.getElementById('carousel-next').addEventListener('click', function() {
  _carouselIdx = (_carouselIdx + 1) % CHAR_NAMES.length;
  updateCarouselDisplay();
});

// Carousel confirm
document.getElementById('carousel-confirm').addEventListener('click', function() {
  state.localModel = _carouselIdx;
  state.localName  = document.getElementById('carousel-name').value.trim().slice(0, 20) || 'Player';
  document.getElementById('player-model').value = _carouselIdx;
  document.getElementById('local-name').value   = state.localName;
  _previewNameplate.classList.add('hidden');
  if (state.rendererModule)
    state.rendererModule.ccall('exit_preview_mode', null, [], []);
  if (_pendingIsHost) {
    showScreen('room');
    mpHost();
  } else {
    showScreen('room');
    document.getElementById('load-rom-label').style.display = 'none';
    setStatus('');
    document.getElementById('mp-status').textContent = 'Room ID: ' + _pendingHostId;
    mpJoin(_pendingHostId);
  }
});

// Join prompt — store host ID then proceed to character select
document.getElementById('join-confirm').addEventListener('click', function() {
  const hostId = document.getElementById('join-hostid').value.trim();
  if (!hostId) {
    document.getElementById('join-prompt-status').textContent = 'Enter a peer ID first';
    return;
  }
  _pendingHostId = hostId;
  document.getElementById('join-prompt').classList.add('hidden');
  openCarousel();
});
document.getElementById('join-hostid').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') document.getElementById('join-confirm').click();
});

// ── Preview nameplate ─────────────────────────────────────────
const _previewNameplate = document.getElementById('preview-nameplate');
document.getElementById('carousel-name').addEventListener('input', function() {
  const name = this.value.trim();
  if (name) {
    _previewNameplate.textContent = name;
    _previewNameplate.classList.remove('hidden');
  } else {
    _previewNameplate.classList.add('hidden');
  }
});

// ── Scene broadcast ───────────────────────────────────────────
// Any change to a scene control is forwarded to connected guests.
document.querySelector('.scene-section').addEventListener('input', broadcastScene);

// ── Key bindings panel ────────────────────────────────────────
// Physical gamepad button index → display name (Standard Gamepad layout)
const _PAD_BTN_NAMES = [
  'A / Cross', 'B / Circle', 'X / Square', 'Y / Triangle',
  'LB / L1', 'RB / R1', 'LT / L2', 'RT / R2',
  'Select', 'Start', 'L3', 'R3',
  'D-Up', 'D-Down', 'D-Left', 'D-Right',
];

const _RETRO_BINDABLE = [
  { id: 8,  label: 'A'       },
  { id: 0,  label: 'B'       },
  { id: 9,  label: 'X'       },
  { id: 1,  label: 'Y'       },
  { id: 3,  label: 'Start'   },
  { id: 2,  label: 'Select'  },
  { id: 4,  label: 'D-Up'    },
  { id: 5,  label: 'D-Down'  },
  { id: 6,  label: 'D-Left'  },
  { id: 7,  label: 'D-Right' },
  { id: 10, label: 'L'       },
  { id: 11, label: 'R'       },
  { id: 12, label: 'L2'      },
  { id: 13, label: 'R2'      },
];

// Convert browser event.code → display label (libretro keyboard mode)
function _keyLabel(code) {
  if (!code) return '—';
  const named = {
    'ArrowUp': '↑', 'ArrowDown': '↓', 'ArrowLeft': '←', 'ArrowRight': '→',
    'ShiftLeft': 'L.Shift', 'ShiftRight': 'R.Shift',
    'ControlLeft': 'L.Ctrl', 'ControlRight': 'R.Ctrl',
    'AltLeft': 'L.Alt', 'AltRight': 'R.Alt',
    'Space': 'Space', 'Enter': 'Enter', 'Backspace': 'Back', 'Tab': 'Tab',
  };
  if (named[code]) return named[code];
  if (code.startsWith('Key'))    return code.slice(3);
  if (code.startsWith('Digit'))  return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num' + code.slice(6);
  return code;
}

// Convert browser event.code → N64Wasm key string
function _codeToN64Key(code) {
  if (code.startsWith('Key'))   return code.slice(3).toLowerCase();
  if (code.startsWith('Digit')) return code.slice(5);
  const map = {
    'ArrowUp': 'Up', 'ArrowDown': 'Down', 'ArrowLeft': 'Left', 'ArrowRight': 'Right',
    'Enter': 'Enter', 'Space': 'Space', 'Backspace': 'Backspace', 'Tab': 'Tab',
    'ShiftLeft': 'LShift', 'ShiftRight': 'RShift',
    'ControlLeft': 'LCtrl', 'ControlRight': 'RCtrl',
    'AltLeft': 'LAlt', 'AltRight': 'RAlt',
    'Backquote': '`', 'Minus': '-', 'Equal': '=',
    'BracketLeft': '[', 'BracketRight': ']', 'Backslash': '\\',
    'Semicolon': ';', 'Quote': "'", 'Comma': ',', 'Period': '.', 'Slash': '/',
  };
  return map[code] || code;
}

// Display label for a N64Wasm key string
function _n64KeyLabel(n64key) {
  if (!n64key) return '—';
  const map = { 'Up': '↑', 'Down': '↓', 'Left': '←', 'Right': '→', 'Enter': 'Enter', 'Space': 'Space' };
  if (map[n64key]) return map[n64key];
  return n64key.length === 1 ? n64key.toUpperCase() : n64key;
}

function initControlsPanel() {
  const panel     = document.getElementById('controls-panel');
  const rowsEl    = document.getElementById('controls-rows');
  const inputSelEl  = document.getElementById('cp-input-select');
  const systemSelEl = document.getElementById('cp-system-select');
  let _listeningId  = null;
  let _listeningEl  = null;
  let _gpListenAnim = null;
  let _system = 'libretro';   // 'libretro' | 'n64'
  let _mode   = 'keyboard';   // 'keyboard' | numeric gamepad index

  // ── Mode descriptor — encapsulates all system/input-specific logic ──────
  function _desc() {
    const isKb  = _mode === 'keyboard';
    const gpIdx = isKb ? -1 : _mode;

    if (_system === 'n64') {
      const bindable = isKb ? N64_BINDABLE : N64_BINDABLE.filter(b => !N64_KB_ONLY.has(b.id));
      return {
        bindable,
        getBinding: isKb
          ? id => _n64KeyLabel(N64_KB[id])
          : id => {
              const b = N64_PAD[id];
              if (b === undefined) return '—';
              if (typeof b === 'string' && b.startsWith('axis:')) {
                const [, a, d] = b.split(':');
                const arrow = (+a % 2 === 0) ? (+d > 0 ? '→' : '←') : (+d > 0 ? '↓' : '↑');
                return (+a <= 1 ? 'L.' : 'R.') + 'Stick ' + arrow;
              }
              return _PAD_BTN_NAMES[b] || 'Btn ' + b;
            },
        onKeyCapture: isKb
          ? (id, code) => { setN64KbBinding(id, _codeToN64Key(code)); render(); }
          : null,
        onPadCapture: !isKb
          ? (id, btnIdx) => { setN64PadBinding(id, btnIdx); render(); }
          : null,
        reset: isKb ? resetN64KbBindings : resetN64PadBindings,
        gpIdx,
      };
    } else {
      return {
        bindable: _RETRO_BINDABLE,
        getBinding: isKb
          ? id => _keyLabel(Object.keys(GAME_MAP).find(k => GAME_MAP[k] === id) || null)
          : id => { for (const [k,v] of Object.entries(PAD_GAME_MAP)) { if (v===id) return _PAD_BTN_NAMES[+k]||'Btn '+k; } return '—'; },
        onKeyCapture: isKb
          ? (id, code) => { setKeyBinding(id, code); render(); }
          : null,
        onPadCapture: !isKb
          ? (id, btnIdx) => { setPadBinding(id, btnIdx); render(); }
          : null,
        reset: isKb ? resetBindings : resetPadBindings,
        gpIdx,
      };
    }
  }

  // ── Listen helpers ────────────────────────────────────────────
  function _stopGpListen() {
    if (_gpListenAnim !== null) { cancelAnimationFrame(_gpListenAnim); _gpListenAnim = null; }
  }

  function _cancelListen() {
    _stopGpListen();
    if (!_listeningEl) return;
    _listeningEl.classList.remove('listening');
    _listeningEl.textContent = _desc().getBinding(_listeningId);
    _listeningEl = null;
    _listeningId = null;
  }

  const _N64_C_ACTIONS = new Set(['CUp', 'CDown', 'CLeft', 'CRight']);
  const _AXIS_THRESHOLD = 0.7;

  function _startGpListen(id, el) {
    const gpIdx   = _desc().gpIdx;
    const gps0    = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp0     = gpIdx >= 0 ? gps0[gpIdx] : [...gps0].find(Boolean);
    const prevBtn = {};
    const prevAxis = {};
    if (gp0) {
      for (let i = 0; i < gp0.buttons.length; i++) prevBtn[i] = gp0.buttons[i].pressed;
      for (let a = 0; a < gp0.axes.length; a++) prevAxis[a] = gp0.axes[a];
    }
    // Only detect axes for N64 C-button actions
    const detectAxes = _system === 'n64' && _N64_C_ACTIONS.has(id);

    function poll() {
      const gps = navigator.getGamepads ? navigator.getGamepads() : [];
      const gp  = gpIdx >= 0 ? gps[gpIdx] : [...gps].find(Boolean);
      if (gp) {
        // Button detection
        for (let i = 0; i < gp.buttons.length; i++) {
          if (gp.buttons[i].pressed && !prevBtn[i]) {
            el.classList.remove('listening');
            const capturedId = _listeningId;
            _listeningEl = null; _listeningId = null; _gpListenAnim = null;
            _desc().onPadCapture(capturedId, i);
            return;
          }
        }
        // Axis detection (N64 C-buttons only)
        if (detectAxes) {
          for (let a = 0; a < gp.axes.length; a++) {
            const val  = gp.axes[a];
            const dir  = val > _AXIS_THRESHOLD ? 1 : val < -_AXIS_THRESHOLD ? -1 : 0;
            const pdir = (prevAxis[a] || 0) > _AXIS_THRESHOLD ? 1 : (prevAxis[a] || 0) < -_AXIS_THRESHOLD ? -1 : 0;
            if (dir !== 0 && dir !== pdir) {
              el.classList.remove('listening');
              const capturedId = _listeningId;
              _listeningEl = null; _listeningId = null; _gpListenAnim = null;
              _desc().onPadCapture(capturedId, 'axis:' + a + ':' + dir);
              return;
            }
          }
        }
      }
      _gpListenAnim = requestAnimationFrame(poll);
    }
    _gpListenAnim = requestAnimationFrame(poll);
  }

  // ── Render ────────────────────────────────────────────────────
  function render() {
    _cancelListen();
    const d = _desc();
    rowsEl.innerHTML = '';
    if (_system === 'n64' && _mode !== 'keyboard') {
      const note = document.createElement('div');
      note.style.cssText = 'color:#444;font:10px monospace;padding:4px 0 8px;border-bottom:1px solid #242424;margin-bottom:2px;';
      note.textContent = 'Analog stick: left stick (automatic)';
      rowsEl.appendChild(note);
    }
    for (const { id, label } of d.bindable) {
      const row = document.createElement('div');
      row.className = 'cp-row';
      const lbl = document.createElement('span');
      lbl.className = 'cp-label';
      lbl.textContent = label;
      const bindBtn = document.createElement('button');
      bindBtn.className = 'cp-key';
      bindBtn.textContent = d.getBinding(id);
      bindBtn.addEventListener('click', function() {
        if (_listeningEl === bindBtn) { _cancelListen(); return; }
        _cancelListen();
        _listeningId = id;
        _listeningEl = bindBtn;
        bindBtn.classList.add('listening');
        bindBtn.textContent = 'press…';
        if (_mode !== 'keyboard') _startGpListen(id, bindBtn);
      });
      row.appendChild(lbl);
      row.appendChild(bindBtn);
      rowsEl.appendChild(row);
    }
  }

  // ── Input selector ────────────────────────────────────────────
  function refreshInputs() {
    const prev = inputSelEl.value;
    inputSelEl.innerHTML = '<option value="keyboard">Keyboard</option>';
    const gps = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
    for (const gp of gps) {
      const opt = document.createElement('option');
      opt.value = 'gp:' + gp.index;
      opt.textContent = (gp.id || 'Gamepad ' + gp.index).slice(0, 36);
      inputSelEl.appendChild(opt);
    }
    if ([...inputSelEl.options].some(o => o.value === prev)) inputSelEl.value = prev;
  }

  systemSelEl.addEventListener('change', function() {
    _cancelListen();
    _system = this.value;
    render();
  });

  inputSelEl.addEventListener('change', function() {
    _cancelListen();
    if (this.value === 'keyboard') {
      _mode = 'keyboard';
      setActiveGamepad(-1);
    } else {
      _mode = parseInt(this.value.replace('gp:', ''));
      setActiveGamepad(_mode);
    }
    render();
  });

  // Keyboard capture — only active in keyboard mode while listening
  document.addEventListener('keydown', function(e) {
    if (_listeningId === null || _mode !== 'keyboard') return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.code === 'Escape') { _cancelListen(); return; }
    const id = _listeningId;
    _listeningEl = null; _listeningId = null;
    _desc().onKeyCapture(id, e.code);
  }, true);

  document.getElementById('cp-refresh').addEventListener('click', refreshInputs);

  document.getElementById('controls-btn').addEventListener('click', function() {
    refreshInputs();
    render();
    panel.classList.toggle('hidden');
    if (document.pointerLockElement) document.exitPointerLock();
  });

  document.getElementById('controls-close').addEventListener('click', function() {
    _cancelListen(); panel.classList.add('hidden');
  });

  document.getElementById('controls-reset').addEventListener('click', function() {
    _desc().reset(); render();
  });

  panel.addEventListener('click', function(e) {
    if (e.target === panel) { _cancelListen(); panel.classList.add('hidden'); }
  });
}

// ── Input setup ───────────────────────────────────────────────
initInput();
initControlsPanel();

// ── Renderer load ─────────────────────────────────────────────
// Starts immediately on page load so the 74 MB .data file downloads in the
// background while the user picks a character.  loadRenderer() is idempotent
// so openCarousel() calling it again is a no-op.
let _rendererLoading = false;

function _onRendererProgress(msg) {
  const fill = document.getElementById('load-progress-fill');
  if (!fill) return;
  const m = msg.match(/\((\d+)\/(\d+)\)/);
  if (m) {
    const loaded = parseInt(m[1]), total = parseInt(m[2]);
    fill.style.width = Math.round(loaded / total * 100) + '%';
  } else if (msg === '' || msg === 'Running...') {
    fill.style.width = '100%';
    setTimeout(function() {
      const wrap = document.getElementById('load-progress-wrap');
      if (wrap) wrap.style.display = 'none';
      document.getElementById('landing-btn-row').classList.remove('hidden');
    }, 400);
  }
}

function loadRenderer() {
  if (_rendererLoading || state.rendererModule) return;
  _rendererLoading = true;
  window.Module = window.Module || {};
  window.Module.setStatus = _onRendererProgress;
  injectAndWait('game_renderer.js', function(mod) {
    state.rendererModule = mod;
    state.frontendGL     = window.GL;
    state.frontendCtx    = document.getElementById('canvas').getContext('webgl2');
    applyRoomXform();
    applyOverscan();
    applyLampPos();
    applyLampIntensity();
    applyTvIntensity();
    applyConeParams();
    setStatus('Ready — drop a ROM to play');
    // If carousel is already showing when renderer finishes, activate preview
    if (!document.getElementById('carousel-controls').classList.contains('hidden'))
      mod.ccall('set_preview_mode', null, ['number'], [_carouselIdx]);
    // Fade in canvas now that the first frame is ready — avoids black flash on init
    requestAnimationFrame(() => {
      document.getElementById('canvas').style.opacity = '1';
    });
  });
}

// ── Initial screen ────────────────────────────────────────────
loadRenderer();   // start the 74 MB .data download immediately
showScreen('landing');
