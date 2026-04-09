// Key bindings panel: rebinding UI for both libretro and N64 controls.
// Extracted from app.js initControlsPanel() to isolate this large UI component.

import { GAME_MAP, setKeyBinding, resetBindings, PAD_GAME_MAP, setPadBinding, resetPadBindings, setActiveGamepad } from './input.js';
import { N64_BINDABLE, N64_KB_ONLY, N64_KB, N64_PAD, setN64KbBinding, setN64PadBinding, resetN64KbBindings, resetN64PadBindings } from './n64-bindings.js';
import { PAD_BTN_NAMES, RETRO_BINDABLE, AXIS_THRESHOLD } from './config.js';

// ── Display label helpers ────────────────────────────────────

// Convert browser event.code → display label (libretro keyboard mode)
function keyLabel(code) {
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
function codeToN64Key(code) {
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
function n64KeyLabel(n64key) {
  if (!n64key) return '—';
  const map = { 'Up': '↑', 'Down': '↓', 'Left': '←', 'Right': '→', 'Enter': 'Enter', 'Space': 'Space' };
  if (map[n64key]) return map[n64key];
  return n64key.length === 1 ? n64key.toUpperCase() : n64key;
}

// ── Main panel init ──────────────────────────────────────────

export function initControlsPanel() {
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
          ? id => n64KeyLabel(N64_KB[id])
          : id => {
              const b = N64_PAD[id];
              if (b === undefined) return '—';
              if (typeof b === 'string' && b.startsWith('axis:')) {
                const [, a, d] = b.split(':');
                const arrow = (+a % 2 === 0) ? (+d > 0 ? '→' : '←') : (+d > 0 ? '↓' : '↑');
                return (+a <= 1 ? 'L.' : 'R.') + 'Stick ' + arrow;
              }
              return PAD_BTN_NAMES[b] || 'Btn ' + b;
            },
        onKeyCapture: isKb
          ? (id, code) => { setN64KbBinding(id, codeToN64Key(code)); render(); }
          : null,
        onPadCapture: !isKb
          ? (id, btnIdx) => { setN64PadBinding(id, btnIdx); render(); }
          : null,
        reset: isKb ? resetN64KbBindings : resetN64PadBindings,
        gpIdx,
      };
    } else {
      return {
        bindable: RETRO_BINDABLE,
        getBinding: isKb
          ? id => keyLabel(Object.keys(GAME_MAP).find(k => GAME_MAP[k] === id) || null)
          : id => { for (const [k,v] of Object.entries(PAD_GAME_MAP)) { if (v===id) return PAD_BTN_NAMES[+k]||'Btn '+k; } return '—'; },
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
            const dir  = val > AXIS_THRESHOLD ? 1 : val < -AXIS_THRESHOLD ? -1 : 0;
            const pdir = (prevAxis[a] || 0) > AXIS_THRESHOLD ? 1 : (prevAxis[a] || 0) < -AXIS_THRESHOLD ? -1 : 0;
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
