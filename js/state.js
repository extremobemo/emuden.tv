// Shared application state with optional change notification.
// Modules that need to react to state changes can subscribe via onStateChange().
// Direct reads via state.foo are still fine for non-reactive access.

import { SHARE_CANVAS_W, SHARE_CANVAS_H } from './config.js';

const _listeners = {};

export const state = {
  rendererModule: null,   // game_renderer.js Emscripten module — set on page load
  coreWorker:     null,   // active libretro Web Worker (null when idle)
  frontendGL:     null,   // Emscripten GL table, captured at renderer load
  frontendCtx:    null,   // WebGL2 context of #canvas
  n64Running:     false,  // true while N64Wasm copyLoop is active
  n64Module:      null,   // N64Wasm module handle
  mpIsHost:       false,  // true when this client is hosting a multiplayer session
  mpConnected:    false,  // true when this client is connected as a guest
  localModel:     0,      // avatar model index (0=cat, 1=incidental_70, 2=mech, 3=knight)
  localName:      '',     // display name shown above this player's head to others
  nowPlaying:     '',     // name of the currently loaded ROM
};

// Set a state field and notify any listeners.
export function setState(key, value) {
  const old = state[key];
  state[key] = value;
  if (old !== value && _listeners[key]) {
    _listeners[key].forEach(fn => fn(value, old));
  }
}

// Subscribe to changes on a specific state key. Returns an unsubscribe function.
export function onStateChange(key, fn) {
  if (!_listeners[key]) _listeners[key] = [];
  _listeners[key].push(fn);
  return () => { _listeners[key] = _listeners[key].filter(f => f !== fn); };
}

// Off-screen canvas used to capture game frames for WebRTC streaming.
// Written to by worker-bridge.js (libretro frames) and n64.js (N64 copyLoop).
// Read by multiplayer.js via shareCanvas.captureStream().
export const shareCanvas = document.createElement('canvas');
shareCanvas.width  = SHARE_CANVAS_W;
shareCanvas.height = SHARE_CANVAS_H;
export const shareCtx = shareCanvas.getContext('2d');
