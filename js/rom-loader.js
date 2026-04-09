// ROM loading: core availability checks, BIOS file inputs, ROM dispatch, disc picker.
// Extracted from app.js to isolate file-handling concerns.

import { setStatus } from './utils.js';
import { spawnCoreWorker, setBiosFile, ps1BiosLoaded, setSaturnBiosFile, saturnBiosLoaded } from './worker-bridge.js';
import { loadN64 } from './n64.js';
import { CORE_MAP, DISC_EXTS, N64_EXTS, BUILD_DIR } from './config.js';

// ── Core readiness checks ────────────────────────────────────
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
  ['gbc', 'gba', 'snes'].forEach(function(id) {
    fetch(BUILD_DIR + 'core_' + id + '.js', { method: 'HEAD' })
      .then(function(r) { setCoreIcon(id, r.ok); })
      .catch(function()  { setCoreIcon(id, false); });
  });

  fetch(BUILD_DIR + 'core_ps1.js', { method: 'HEAD' })
    .then(function(r) {
      _ps1CoreAvailable = r.ok;
      setCoreIcon('ps1', false, r.ok ? '(needs BIOS)' : '(file missing)');
    })
    .catch(function() { _ps1CoreAvailable = false; setCoreIcon('ps1', false, '(file missing)'); });

  fetch(BUILD_DIR + 'core_saturn.js', { method: 'HEAD' })
    .then(function(r) { setCoreIcon('saturn', false, r.ok ? '(needs BIOS)' : '(file missing)'); })
    .catch(function() { setCoreIcon('saturn', false, '(file missing)'); });

  Promise.all([
    fetch(BUILD_DIR + 'n64wasm.js', { method: 'HEAD' }).then(r => r.ok).catch(() => false),
    fetch(BUILD_DIR + 'assets.zip', { method: 'HEAD' }).then(r => r.ok).catch(() => false),
  ]).then(function([wasm, assets]) {
    if (wasm && assets) { setCoreIcon('n64', true); }
    else { setCoreIcon('n64', false, wasm ? '(missing assets.zip)' : '(file missing)'); }
  });
}

// ── Disc system picker ───────────────────────────────────────
let _discPickerFile = null;
let _discPickerExt  = null;

function launchDisc(bundle) {
  document.getElementById('disc-prompt').classList.add('hidden');
  const file = _discPickerFile;
  const ext  = _discPickerExt;
  _discPickerFile = null;
  _discPickerExt  = null;
  spawnCoreWorker(bundle, file, ext);
}

const _discSystems = [
  { id: 'disc-pick-ps1',    bundle: BUILD_DIR + 'core_ps1.js',    biosCheck: () => ps1BiosLoaded,    biosMsg: 'Load a PS1 BIOS (.bin) first, then reload your disc' },
  { id: 'disc-pick-saturn', bundle: BUILD_DIR + 'core_saturn.js', biosCheck: () => saturnBiosLoaded, biosMsg: 'Load a Saturn BIOS (.bin) first via Settings, then reload your disc' },
];

// ── Init ─────────────────────────────────────────────────────

export function initRomLoader() {
  checkCores();

  // BIOS file inputs
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

  // ROM input
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

    if (bundle.endsWith('core_saturn.js') && !saturnBiosLoaded) {
      setStatus('Load a Saturn BIOS (.bin) first via Settings, then reload your disc');
      return;
    }

    spawnCoreWorker(bundle, file, ext);
  });

  // Disc picker buttons
  _discSystems.forEach(function({ id, bundle, biosCheck, biosMsg }) {
    document.getElementById(id).addEventListener('click', function() {
      if (!biosCheck()) {
        document.getElementById('disc-prompt').classList.add('hidden');
        setStatus(biosMsg);
        return;
      }
      launchDisc(bundle);
    });
  });
}
