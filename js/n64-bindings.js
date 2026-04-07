// N64-specific key binding storage and config.txt generation.
// nbarkhina/N64Wasm reads config.txt with a fixed line format:
//   Lines  0-14: gamepad button indices (Standard Gamepad API) per N64 action
//   Lines 15-33: keyboard key strings per N64 action
//   Lines 34+  : feature flags (fps display, save slots, etc.)

// Slot index within the gamepad section (lines 0-14)
const _PAD_SLOT = {
  DUp: 0, DDown: 1, DLeft: 2, DRight: 3,
  A: 4, B: 5, Start: 6, Z: 7, L: 8, R: 9,
  // slot 10 = Menu (R3, hardcoded to 11)
  CLeft: 11, CRight: 12, CUp: 13, CDown: 14,
};

// Slot index within the keyboard section (lines 15-33, 0-based within section)
const _KB_SLOT = {
  DLeft: 0, DRight: 1, DUp: 2, DDown: 3,
  Start: 4, CUp: 5, CDown: 6, CLeft: 7, CRight: 8,
  Z: 9, L: 10, R: 11, B: 12, A: 13,
  // slot 14 = Menu (backtick, hardcoded)
  AnalogUp: 15, AnalogDown: 16, AnalogLeft: 17, AnalogRight: 18,
};

const _DEFAULT_KB = {
  DLeft: 'b', DRight: 'n', DUp: 'y', DDown: 'h',
  Start: 'Enter',
  CUp: 'i', CDown: 'k', CLeft: 'j', CRight: 'l',
  Z: 'a', L: 'q', R: 'e', B: 's', A: 'd',
  AnalogUp: 'Up', AnalogDown: 'Down', AnalogLeft: 'Left', AnalogRight: 'Right',
};

const _DEFAULT_PAD = {
  DUp: 12, DDown: 13, DLeft: 14, DRight: 15,
  A: 0, B: 2, Start: 9, Z: 4, L: 6, R: 5,
};

function _load(storageKey, defaults) {
  try {
    const s = localStorage.getItem(storageKey);
    if (s) return { ...defaults, ...JSON.parse(s) };
  } catch(e) {}
  return { ...defaults };
}

export const N64_KB  = _load('retro-cube-n64-kb',  _DEFAULT_KB);
export const N64_PAD = _load('retro-cube-n64-pad', _DEFAULT_PAD);

export function setN64KbBinding(action, n64key) {
  for (const k of Object.keys(N64_KB)) {
    if (N64_KB[k] === n64key) delete N64_KB[k];
  }
  N64_KB[action] = n64key;
  localStorage.setItem('retro-cube-n64-kb', JSON.stringify(N64_KB));
}

// binding is either a button index (number) or an axis string "axis:N:D"
// where N = axis index, D = direction (+1 or -1)
export function setN64PadBinding(action, binding) {
  // Remove any existing entry with the same binding value
  for (const k of Object.keys(N64_PAD)) {
    if (N64_PAD[k] === binding) delete N64_PAD[k];
  }
  N64_PAD[action] = binding;
  localStorage.setItem('retro-cube-n64-pad', JSON.stringify(N64_PAD));
}

export function resetN64KbBindings() {
  for (const k of Object.keys(N64_KB)) delete N64_KB[k];
  Object.assign(N64_KB, _DEFAULT_KB);
  localStorage.removeItem('retro-cube-n64-kb');
}

export function resetN64PadBindings() {
  for (const k of Object.keys(N64_PAD)) delete N64_PAD[k];
  Object.assign(N64_PAD, _DEFAULT_PAD);
  localStorage.removeItem('retro-cube-n64-pad');
}

export function buildN64Config() {
  const padLines = Array(15).fill('-1');
  for (const [action, slot] of Object.entries(_PAD_SLOT)) {
    const binding = N64_PAD[action];
    // Axis bindings are handled at runtime via keyboard injection — use -1 in config
    if (typeof binding === 'number') padLines[slot] = String(binding);
  }
  padLines[10] = '11';  // Menu button = R3, always present

  const kbLines = Array(19).fill('');
  for (const [action, slot] of Object.entries(_KB_SLOT)) {
    const key = N64_KB[action];
    if (key !== undefined) kbLines[slot] = key;
  }
  kbLines[14] = '`';  // Menu key = backtick, always present

  return [
    ...padLines, ...kbLines,
    '0','0','0',   // save slots
    '0','0','1',   // fps display, swap sticks, disable audio sync
    '0','0','0',   // invert Y axis for P2/P3/P4
    '0','0','0','0',
  ].join('\r\n') + '\r\n';
}

// Actions only bindable via keyboard (no gamepad axis equivalent)
export const N64_KB_ONLY = new Set(['AnalogUp', 'AnalogDown', 'AnalogLeft', 'AnalogRight']);

export const N64_BINDABLE = [
  { id: 'A',           label: 'A'        },
  { id: 'B',           label: 'B'        },
  { id: 'Start',       label: 'Start'    },
  { id: 'Z',           label: 'Z Trigger'},
  { id: 'L',           label: 'L Trigger'},
  { id: 'R',           label: 'R Trigger'},
  { id: 'DUp',         label: 'D-Up'     },
  { id: 'DDown',       label: 'D-Down'   },
  { id: 'DLeft',       label: 'D-Left'   },
  { id: 'DRight',      label: 'D-Right'  },
  { id: 'CUp',         label: 'C-Up'     },
  { id: 'CDown',       label: 'C-Down'   },
  { id: 'CLeft',       label: 'C-Left'   },
  { id: 'CRight',      label: 'C-Right'  },
  { id: 'AnalogUp',    label: 'Stick ↑'  },
  { id: 'AnalogDown',  label: 'Stick ↓'  },
  { id: 'AnalogLeft',  label: 'Stick ←'  },
  { id: 'AnalogRight', label: 'Stick →'  },
];
