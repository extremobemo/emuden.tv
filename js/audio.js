// Audio subsystem: AudioContext lifecycle, spatial PannerNode, ring buffer drain,
// and per-frame listener position updates driven by the renderer's player position.

import * as renderer from './renderer.js';
import { AUDIO_RING_SIZE, AUDIO_BUFFER_SIZE } from './config.js';

const audioRing    = new Float32Array(AUDIO_RING_SIZE);
let audioRingWrite = 0;
let audioRingRead  = 0;

let audioCtx        = null;
let audioNode       = null;
let audioPanner     = null;
let viewerPanner    = null;
let mediaStreamDest = null;

// rAF IDs for lifecycle management
let _hostListenerAnim   = null;
let _viewerListenerAnim = null;

// Shared panner config — updated live by the settings sliders
const _cfg = {
  x: 0, y: 0, z: 0,
  refDistance:   100,
  maxDistance:   10,
  rolloffFactor: 2,
  distanceModel: 'inverse',
};

function _applyPannerCfg(p) {
  if (!p) return;
  p.distanceModel = _cfg.distanceModel;
  p.refDistance   = _cfg.refDistance;
  p.maxDistance   = _cfg.maxDistance;
  p.rolloffFactor = _cfg.rolloffFactor;
  if (p.positionX !== undefined) {
    p.positionX.value = _cfg.x;
    p.positionY.value = _cfg.y;
    p.positionZ.value = _cfg.z;
  } else {
    p.setPosition(_cfg.x, _cfg.y, _cfg.z);
  }
}

// Feed Int16 stereo samples (from worker) into the JS ring buffer.
export function receiveAudio(buf) {
  const s = new Int16Array(buf);
  for (let i = 0; i < s.length; i++) {
    audioRing[audioRingWrite % AUDIO_RING_SIZE] = s[i] / 32768.0;
    audioRingWrite++;
  }
}

// Start (or restart) the AudioContext for the given sample rate.
// Called once per core load when the worker sends its 'ready' message.
export function startAudio(sampleRate) {
  // Close previous context if sample rate changed (different core)
  if (audioCtx && audioCtx.sampleRate !== sampleRate) {
    audioCtx.close();
    audioCtx = null; audioNode = null; audioPanner = null; mediaStreamDest = null;
  }
  if (!audioCtx) {
    try { audioCtx = new AudioContext({ sampleRate }); }
    catch(e) { audioCtx = new AudioContext(); }
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  // Reset ring buffer so stale samples from the previous core don't play
  audioRingWrite = 0; audioRingRead = 0;

  if (audioNode) return; // ScriptProcessor already wired for this context

  // Seed source position from TV world coords on first init (sliders start at 0,0,0)
  if (_cfg.x === 0 && _cfg.y === 0 && _cfg.z === 0 && renderer.isReady()) {
    const tvx = Math.round(renderer.getTvX());
    const tvy = Math.round(renderer.getTvY());
    const tvz = Math.round(renderer.getTvZ());
    document.getElementById('audio-src-x').value = tvx;
    document.getElementById('audio-src-y').value = tvy;
    document.getElementById('audio-src-z').value = tvz;
    _setPos(tvx, tvy, tvz);
  }

  // PannerNode: audio source at the position set by the audio sliders
  audioPanner = audioCtx.createPanner();
  audioPanner.panningModel = 'HRTF';
  _applyPannerCfg(audioPanner);

  audioNode = audioCtx.createScriptProcessor(AUDIO_BUFFER_SIZE, 0, 2);
  audioNode.onaudioprocess = function(ev) {
    const L = ev.outputBuffer.getChannelData(0);
    const R = ev.outputBuffer.getChannelData(1);
    for (let i = 0; i < L.length; i++) {
      if (audioRingWrite - audioRingRead >= 2) {
        R[i] = audioRing[audioRingRead % AUDIO_RING_SIZE]; audioRingRead++;
        L[i] = audioRing[audioRingRead % AUDIO_RING_SIZE]; audioRingRead++;
      } else {
        L[i] = R[i] = 0;
      }
    }
  };

  // Chain: ScriptProcessor → PannerNode → speakers
  audioNode.connect(audioPanner);
  audioPanner.connect(audioCtx.destination);

  // Also tap raw stereo off the ScriptProcessor for WebRTC streaming to guests
  mediaStreamDest = audioCtx.createMediaStreamDestination();
  audioNode.connect(mediaStreamDest);

  // Per-frame: update Web Audio listener to match the player's position and look direction
  if (_hostListenerAnim !== null) cancelAnimationFrame(_hostListenerAnim);
  (function updateListener() {
    if (audioCtx && renderer.isReady()) {
      _updateListenerPos(audioCtx.listener);
    }
    _hostListenerAnim = requestAnimationFrame(updateListener);
  })();
}

// Shared listener position update logic
function _updateListenerPos(listener) {
  const lx  = renderer.getLocalX();
  const ly  = renderer.getLocalY();
  const lz  = renderer.getLocalZ();
  const yaw = renderer.getLocalYaw();
  const pit = renderer.getLocalPitch();
  const cosPit = Math.cos(pit);
  const fx = cosPit * Math.sin(yaw);
  const fy = Math.sin(pit);
  const fz = cosPit * Math.cos(yaw);
  if (listener.positionX !== undefined) {
    listener.positionX.value = lx;
    listener.positionY.value = ly;
    listener.positionZ.value = lz;
    listener.forwardX.value  = fx;
    listener.forwardY.value  = fy;
    listener.forwardZ.value  = fz;
    listener.upX.value = 0; listener.upY.value = 1; listener.upZ.value = 0;
  } else {
    listener.setPosition(lx, ly, lz);
    listener.setOrientation(fx, fy, fz, 0, 1, 0);
  }
}

// Returns the audio track from the ScriptProcessor output for inclusion in a WebRTC stream.
export function getGameAudioTrack() {
  if (!mediaStreamDest) return null;
  const tracks = mediaStreamDest.stream.getAudioTracks();
  return tracks.length ? tracks[0] : null;
}

// Guest-side: receive an audio track from the host and play it with spatial sound.
export function startViewerAudio(audioTrack) {
  let ctx;
  try { ctx = new AudioContext(); }
  catch(e) { console.warn('viewer audio:', e); return; }
  if (ctx.state === 'suspended') ctx.resume();

  const source = ctx.createMediaStreamSource(new MediaStream([audioTrack]));
  viewerPanner = ctx.createPanner();
  viewerPanner.panningModel = 'HRTF';
  _applyPannerCfg(viewerPanner);

  source.connect(viewerPanner);
  viewerPanner.connect(ctx.destination);

  if (_viewerListenerAnim !== null) cancelAnimationFrame(_viewerListenerAnim);
  (function updateViewerListener() {
    if (ctx && renderer.isReady()) {
      _updateListenerPos(ctx.listener);
    }
    _viewerListenerAnim = requestAnimationFrame(updateViewerListener);
  })();
}

// ── Public API for settings-ui.js and multiplayer.js ─────────

function _setPos(x, y, z) {
  _cfg.x = x; _cfg.y = y; _cfg.z = z;
  [audioPanner, viewerPanner].forEach(function(p) {
    if (!p) return;
    if (p.positionX !== undefined) {
      p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z;
    } else {
      p.setPosition(x, y, z);
    }
  });
  renderer.setDebugCubePos(x, y, z);
}

export function setAudioSourcePos(x, y, z) {
  _setPos(x, y, z);
}

export function setAudioPannerSettings(refDist, maxDist, rolloff, model) {
  _cfg.refDistance = refDist; _cfg.maxDistance = maxDist;
  _cfg.rolloffFactor = rolloff; _cfg.distanceModel = model;
  [audioPanner, viewerPanner].forEach(function(p) {
    if (!p) return;
    p.refDistance = refDist; p.maxDistance = maxDist;
    p.rolloffFactor = rolloff; p.distanceModel = model;
  });
}

// ── Lifecycle cleanup ────────────────────────────────────────

export function stopAudio() {
  if (_hostListenerAnim !== null) { cancelAnimationFrame(_hostListenerAnim); _hostListenerAnim = null; }
  if (_viewerListenerAnim !== null) { cancelAnimationFrame(_viewerListenerAnim); _viewerListenerAnim = null; }
  if (audioCtx) { audioCtx.close(); audioCtx = null; }
  audioNode = null; audioPanner = null; viewerPanner = null; mediaStreamDest = null;
}
