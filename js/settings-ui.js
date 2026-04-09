// Settings panel: all slider wiring for scene, lighting, audio, and player tuning.
// Extracted from app.js and audio.js to keep UI concerns in one place.

import { setState } from './state.js';
import * as renderer from './renderer.js';
import { setAudioSourcePos, setAudioPannerSettings } from './audio.js';
import { broadcastScene } from './multiplayer.js';

// ── Generic helpers ──────────────────────────────────────────

function val(id) { return parseFloat(document.getElementById(id).value) || 0; }

function wireSliders(ids, onChange) {
  ids.forEach(id => document.getElementById(id).addEventListener('input', onChange));
}

// ── Room transform ───────────────────────────────────────────

function applyRoomXform() {
  const scale = val('room-scale');
  document.getElementById('room-scale-val').textContent = scale;
  renderer.setRoomXform(scale, val('room-roty'), val('room-tx'), val('room-ty'), val('room-tz'));
}

// ── Overscan ─────────────────────────────────────────────────

function applyOverscan() {
  renderer.setOverscan(val('overscan-x'), val('overscan-y'));
}

// ── Lamp ─────────────────────────────────────────────────────

function applyLampPos() {
  renderer.setLampPos(val('lamp-x'), val('lamp-y'), val('lamp-z'));
}

function applyLampIntensity() {
  const v = val('lamp-intensity');
  document.getElementById('lamp-intensity-val').textContent = v;
  renderer.setLampIntensity(v);
}

// ── TV light ─────────────────────────────────────────────────

function applyTvIntensity() {
  const v = val('tv-intensity');
  document.getElementById('tv-intensity-val').textContent = v;
  renderer.setTvLightIntensity(v);
}

// ── Cone params ──────────────────────────────────────────────

function applyConeParams() {
  renderer.setConeYaw(val('cone-yaw'));
  renderer.setConePitch(val('cone-pitch'));
  renderer.setConePower(val('cone-power'));
}

// ── Audio source position ────────────────────────────────────

function applyAudioSource() {
  setAudioSourcePos(val('audio-src-x'), val('audio-src-y'), val('audio-src-z'));
}

function applyAudioPanner() {
  const refDist = val('audio-ref-dist');
  const maxDist = val('audio-max-dist');
  const rolloff = val('audio-rolloff');
  const model   = document.getElementById('audio-model').value;
  document.getElementById('audio-ref-dist-val').textContent = refDist;
  document.getElementById('audio-max-dist-val').textContent = maxDist;
  document.getElementById('audio-rolloff-val').textContent  = rolloff;
  setAudioPannerSettings(refDist, maxDist, rolloff, model);
}

// ── Apply all settings (called when renderer becomes ready) ──

export function applyAllSettings() {
  applyRoomXform();
  applyOverscan();
  applyLampPos();
  applyLampIntensity();
  applyTvIntensity();
  applyConeParams();
}

// ── Init — wire every slider/input ───────────────────────────

export function initSettingsUI() {
  wireSliders(['room-scale','room-roty','room-tx','room-ty','room-tz'], applyRoomXform);
  wireSliders(['overscan-x','overscan-y'], applyOverscan);
  wireSliders(['lamp-x','lamp-y','lamp-z'], applyLampPos);
  document.getElementById('lamp-intensity').addEventListener('input', applyLampIntensity);
  document.getElementById('tv-intensity').addEventListener('input', applyTvIntensity);
  wireSliders(['cone-yaw','cone-pitch','cone-power'], applyConeParams);

  document.getElementById('my-y').addEventListener('input', function() {
    renderer.setLocalY(parseFloat(this.value));
  });
  document.getElementById('cat-eye-height').addEventListener('input', function() {
    renderer.setCatEyeHeight(parseFloat(this.value));
  });
  document.getElementById('player-model').addEventListener('change', function() {
    setState('localModel', parseInt(this.value));
  });
  document.getElementById('local-name').addEventListener('input', function() {
    setState('localName', this.value.trim().slice(0, 20));
  });

  // Audio source sliders
  wireSliders(['audio-src-x','audio-src-y','audio-src-z'], applyAudioSource);
  wireSliders(['audio-ref-dist','audio-max-dist','audio-rolloff'], applyAudioPanner);
  document.getElementById('audio-model').addEventListener('input', applyAudioPanner);

  document.getElementById('audio-debug-cube').addEventListener('change', function() {
    if (this.checked) {
      renderer.setDebugCubePos(val('audio-src-x'), val('audio-src-y'), val('audio-src-z'));
    }
    renderer.setDebugCubeVisible(this.checked ? 1 : 0);
  });

  // Scene broadcast: any change to a scene control is forwarded to connected guests
  document.querySelector('.scene-section').addEventListener('input', broadcastScene);
}
