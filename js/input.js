// Keyboard, mouse, and gamepad input handlers.
// WASD / left-stick / mouse / right-stick → renderer (player movement + camera)
// D-pad / face / shoulder buttons → libretro core (port 0 for host, relayed for guests)

import { state } from './state.js';
import { mpSendButton, mpSendAxis } from './multiplayer.js';
import * as renderer from './renderer.js';
import { MOVE_KEYS, DEFAULT_GAME_MAP, DEFAULT_PAD_MAP, DEAD_ZONE, ANALOG_MAX } from './config.js';

// ── Keyboard bindings ────────────────────────────────────────

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

// ── Gamepad bindings ─────────────────────────────────────────

let _activeGP = -1;  // -1 = accept all gamepads

export function setActiveGamepad(idx) { _activeGP = idx; }

function _loadStoredPadBindings() {
  try {
    const s = localStorage.getItem('retro-cube-pad-bindings');
    if (s) return JSON.parse(s);
  } catch(e) {}
  return { ...DEFAULT_PAD_MAP };
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
  Object.assign(PAD_GAME_MAP, DEFAULT_PAD_MAP);
  localStorage.removeItem('retro-cube-pad-bindings');
}

// ── Internal helpers ─────────────────────────────────────────

const _padPrev = {};   // { [gamepadIndex]: { buttons: bool[], axes: number[] } }
let _pollAnim = null;

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

    // ── Game buttons (face, dpad, shoulder) ────────────────────
    for (const [btnIdxStr, retroId] of Object.entries(PAD_GAME_MAP)) {
      const btnIdx = +btnIdxStr;
      if (btnIdx >= gp.buttons.length) continue;
      const pressed = gp.buttons[btnIdx].pressed;
      if (pressed !== prev.buttons[btnIdx]) {
        prev.buttons[btnIdx] = pressed;
        sendGameButton(retroId, pressed);
      }
    }

    // ── Analog sticks → core worker ───────────────────────────
    // axes 0,1 = left stick (stick 0); axes 2,3 = right stick (stick 1)
    for (let ai = 0; ai < 4; ai++) {
      const val = gp.axes[ai] || 0;
      if (Math.abs(val - (prev.axes[ai] || 0)) > DEAD_ZONE) {
        prev.axes[ai] = val;
        const stick = ai < 2 ? 0 : 1;
        const axis  = ai % 2;
        const i16   = Math.round(Math.max(-1, Math.min(1, val)) * ANALOG_MAX);
        if (state.coreWorker) {
          state.coreWorker.postMessage({ type: 'axis', port: 0, stick, axis, value: i16 });
        }
        if (state.mpConnected && ai < 2) {
          mpSendAxis(ai, val);
        }
      }
    }
  }
  _pollAnim = requestAnimationFrame(pollGamepads);
}

// ── Public API ───────────────────────────────────────────────

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
    if (document.pointerLockElement === canvas) {
      renderer.addMouseDelta(e.movementX, e.movementY);
    }
  });

  document.addEventListener('keydown', e => {
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (MOVE_KEYS[e.code] !== undefined) {
      e.preventDefault();
      renderer.setMoveKey(MOVE_KEYS[e.code], 1);
    }
    if (GAME_MAP[e.code] !== undefined) {
      e.preventDefault();
      sendGameButton(GAME_MAP[e.code], true);
    }
  });

  document.addEventListener('keyup', e => {
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (MOVE_KEYS[e.code] !== undefined)
      renderer.setMoveKey(MOVE_KEYS[e.code], 0);
    if (GAME_MAP[e.code] !== undefined)
      sendGameButton(GAME_MAP[e.code], false);
  });

  // Start gamepad polling — cheap no-op when no controller is connected
  _pollAnim = requestAnimationFrame(pollGamepads);
}

export function stopInput() {
  if (_pollAnim !== null) { cancelAnimationFrame(_pollAnim); _pollAnim = null; }
}
