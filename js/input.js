// Keyboard, mouse, and gamepad input handlers.
// WASD / left-stick / mouse / right-stick → renderer (player movement + camera)
// D-pad / face / shoulder buttons → libretro core (port 0 for host, relayed for guests)

import { state } from './state.js';
import { mpSendButton, mpSendAxis } from './multiplayer.js';

const MOVE_MAP = { 'KeyW': 0, 'KeyS': 1, 'KeyA': 2, 'KeyD': 3 };

// RETRO_DEVICE_ID_JOYPAD button IDs:
// B=0 Y=1 SELECT=2 START=3 UP=4 DOWN=5 LEFT=6 RIGHT=7 A=8 X=9 L=10 R=11 L2=12 R2=13 L3=14 R3=15
const DEFAULT_GAME_MAP = {
  'ArrowUp':    4,
  'ArrowDown':  5,
  'ArrowLeft':  6,
  'ArrowRight': 7,
  'Enter':      3,
  'ShiftLeft':  2,
  'ShiftRight': 2,
  'KeyZ':       8,   // A button
  'KeyX':       0,   // B button
  'KeyQ':      10,   // L
  'KeyE':      11,   // R
};

function _loadStoredBindings() {
  try {
    const s = localStorage.getItem('retro-cube-bindings');
    if (s) return JSON.parse(s);
  } catch(e) {}
  return { ...DEFAULT_GAME_MAP };
}

// Exported mutable map — mutated in place so event handlers always see current bindings
export const GAME_MAP = _loadStoredBindings();

export function setKeyBinding(retroId, code) {
  for (const k of Object.keys(GAME_MAP)) {
    if (GAME_MAP[k] === retroId) delete GAME_MAP[k];
  }
  if (code) GAME_MAP[code] = retroId;
  localStorage.setItem('retro-cube-bindings', JSON.stringify(GAME_MAP));
}

export function resetBindings() {
  for (const k of Object.keys(GAME_MAP)) delete GAME_MAP[k];
  Object.assign(GAME_MAP, DEFAULT_GAME_MAP);
  localStorage.removeItem('retro-cube-bindings');
}

let _activeGP = -1;  // -1 = accept all gamepads

export function setActiveGamepad(idx) { _activeGP = idx; }

// Standard Gamepad API button index → RETRO_DEVICE_ID_JOYPAD
const PAD_BUTTON_MAP = [
  [0,  8],  // A (south)  → RETRO A
  [1,  0],  // B (east)   → RETRO B
  [2,  9],  // X (west)   → RETRO X
  [3,  1],  // Y (north)  → RETRO Y
  [4,  10], // L1         → RETRO L
  [5,  11], // R1         → RETRO R
  [6,  12], // L2         → RETRO L2
  [7,  13], // R2         → RETRO R2
  [8,  2],  // Select     → RETRO SELECT
  [9,  3],  // Start      → RETRO START
  [10, 14], // L3         → RETRO L3
  [11, 15], // R3         → RETRO R3
  [12, 4],  // D-up       → RETRO UP
  [13, 5],  // D-down     → RETRO DOWN
  [14, 6],  // D-left     → RETRO LEFT
  [15, 7],  // D-right    → RETRO RIGHT
];

const _DEFAULT_PAD_MAP = Object.fromEntries(PAD_BUTTON_MAP);  // padBtnIdx → retroId

function _loadStoredPadBindings() {
  try {
    const s = localStorage.getItem('retro-cube-pad-bindings');
    if (s) return JSON.parse(s);
  } catch(e) {}
  return { ..._DEFAULT_PAD_MAP };
}

// Exported mutable map — mutated in place so pollGamepads always sees current bindings
export const PAD_GAME_MAP = _loadStoredPadBindings();

export function setPadBinding(retroId, padBtnIdx) {
  for (const k of Object.keys(PAD_GAME_MAP)) {
    if (PAD_GAME_MAP[k] === retroId) delete PAD_GAME_MAP[k];
  }
  PAD_GAME_MAP[padBtnIdx] = retroId;
  localStorage.setItem('retro-cube-pad-bindings', JSON.stringify(PAD_GAME_MAP));
}

export function resetPadBindings() {
  for (const k of Object.keys(PAD_GAME_MAP)) delete PAD_GAME_MAP[k];
  Object.assign(PAD_GAME_MAP, _DEFAULT_PAD_MAP);
  localStorage.removeItem('retro-cube-pad-bindings');
}

const _padPrev = {};   // { [gamepadIndex]: { buttons: bool[], axes: number[] } }

// Send a game button press to the core.
// Host always owns port 0; guests send to the host which assigns their port.
function sendGameButton(id, pressed) {
  if (state.mpIsHost) {
    if (state.coreWorker)
      state.coreWorker.postMessage({ type: 'button', port: 0, id, pressed });
  } else if (state.mpConnected) {
    mpSendButton(id, pressed);
  } else if (state.coreWorker) {
    state.coreWorker.postMessage({ type: 'button', port: 0, id, pressed });
  }
}

function pollGamepads() {
  const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (let gi = 0; gi < gamepads.length; gi++) {
    if (_activeGP >= 0 && gi !== _activeGP) continue;
    const gp = gamepads[gi];
    if (!gp) continue;

    if (!_padPrev[gi])
      _padPrev[gi] = { buttons: new Array(gp.buttons.length).fill(false), axes: [0, 0, 0, 0] };
    const prev = _padPrev[gi];

    // ── Game buttons (face, dpad, shoulder) ──────────────────────────────────
    for (const [btnIdxStr, retroId] of Object.entries(PAD_GAME_MAP)) {
      const btnIdx = +btnIdxStr;
      if (btnIdx >= gp.buttons.length) continue;
      const pressed = gp.buttons[btnIdx].pressed;
      if (pressed !== prev.buttons[btnIdx]) {
        prev.buttons[btnIdx] = pressed;
        sendGameButton(retroId, pressed);
      }
    }

    // ── Analog sticks → core worker ─────────────────────────────────────────
    // axes 0,1 = left stick (stick 0); axes 2,3 = right stick (stick 1)
    for (let ai = 0; ai < 4; ai++) {
      const val = gp.axes[ai] || 0;
      if (Math.abs(val - (prev.axes[ai] || 0)) > 0.02) {
        prev.axes[ai] = val;
        const stick = ai < 2 ? 0 : 1;
        const axis  = ai % 2;
        // libretro analog range: -32768 to 32767
        const i16   = Math.round(Math.max(-1, Math.min(1, val)) * 32767);
        if (state.coreWorker) {
          state.coreWorker.postMessage({ type: 'axis', port: 0, stick, axis, value: i16 });
        }
        if (state.mpConnected && ai < 2) {
          mpSendAxis(ai, val);
        }
      }
    }

  }
  requestAnimationFrame(pollGamepads);
}

export function initInput() {
  const canvas  = document.getElementById('canvas');
  const overlay = document.getElementById('overlay');

  canvas.addEventListener('click', () => {
    if (!document.getElementById('carousel-controls').classList.contains('hidden')) return;
    canvas.requestPointerLock();
  });

  document.addEventListener('pointerlockchange', () => {
    overlay.classList.add('hidden');
  });

  document.addEventListener('mousemove', e => {
    if (document.pointerLockElement === canvas && state.rendererModule) {
      state.rendererModule.ccall('add_mouse_delta', 'void',
        ['number','number'], [e.movementX, e.movementY]);
    }
  });

  document.addEventListener('keydown', e => {
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (MOVE_MAP[e.code] !== undefined && state.rendererModule) {
      e.preventDefault();
      state.rendererModule.ccall('set_move_key', 'void',
        ['number','number'], [MOVE_MAP[e.code], 1]);
    }
    if (GAME_MAP[e.code] !== undefined) {
      e.preventDefault();
      sendGameButton(GAME_MAP[e.code], true);
    }
  });

  document.addEventListener('keyup', e => {
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (MOVE_MAP[e.code] !== undefined && state.rendererModule)
      state.rendererModule.ccall('set_move_key', 'void',
        ['number','number'], [MOVE_MAP[e.code], 0]);
    if (GAME_MAP[e.code] !== undefined)
      sendGameButton(GAME_MAP[e.code], false);
  });

  // Start gamepad polling — cheap no-op when no controller is connected
  requestAnimationFrame(pollGamepads);
}
