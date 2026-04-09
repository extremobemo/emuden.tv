// Centralized constants used across modules.
// Keeps magic numbers out of logic code and provides a single place to tune values.

// ── Build paths ──────────────────────────────────────────────
// All compiled WASM bundles and prebuilt assets live under this directory.
export const BUILD_DIR = 'build/';

// ── Input ────────────────────────────────────────────────────
export const DEAD_ZONE       = 0.02;
export const AXIS_THRESHOLD  = 0.7;
export const ANALOG_MAX      = 32767;
export const GAMEPAD_EVENT_DELAY_MS = 500;

// RETRO_DEVICE_ID_JOYPAD button IDs
export const RETRO = {
  B: 0, Y: 1, SELECT: 2, START: 3,
  UP: 4, DOWN: 5, LEFT: 6, RIGHT: 7,
  A: 8, X: 9, L: 10, R: 11,
  L2: 12, R2: 13, L3: 14, R3: 15,
};

// Movement key codes → renderer.cpp set_move_key index
export const MOVE_KEYS = { 'KeyW': 0, 'KeyS': 1, 'KeyA': 2, 'KeyD': 3 };

// ── Audio ────────────────────────────────────────────────────
export const AUDIO_RING_SIZE   = 44100 * 4;   // 2 s stereo at max sample rate
export const AUDIO_BUFFER_SIZE = 4096;         // ScriptProcessorNode buffer frames
export const N64_AUDIO_RING    = 64000;        // int16 entries (32 k stereo frames)
export const N64_AUDIO_BUFFER  = 1024;         // ScriptProcessorNode buffer frames

// ── Canvas ───────────────────────────────────────────────────
export const CANVAS_ASPECT          = 16 / 9;
export const CANVAS_MAX_WIDTH_RATIO = 0.75;
export const CANVAS_PADDING         = 80;
export const SHARE_CANVAS_W         = 640;
export const SHARE_CANVAS_H         = 480;

// ── Multiplayer ──────────────────────────────────────────────
export const POSITION_SYNC_INTERVAL_MS = 16;
export const MAX_REMOTE_PLAYERS        = 8;
export const VIDEO_BITRATE             = 4_000_000;
export const VIDEO_FRAMERATE           = 60;
export const NAMEPLATE_W               = 256;
export const NAMEPLATE_H               = 64;

// ── N64 ──────────────────────────────────────────────────────
export const N64_AXIS_THRESHOLD = 0.5;
export const N64_FRAME_W        = 640;
export const N64_FRAME_H        = 480;

// ── Core routing ─────────────────────────────────────────────
// File extension → core bundle path (relative to site root)
export const CORE_MAP = {
  'gb':  BUILD_DIR + 'core_gbc.js',
  'gbc': BUILD_DIR + 'core_gbc.js',
  'gba': BUILD_DIR + 'core_gba.js',
  'sfc': BUILD_DIR + 'core_snes.js',
  'smc': BUILD_DIR + 'core_snes.js',
  'fig': BUILD_DIR + 'core_snes.js',
  'swc': BUILD_DIR + 'core_snes.js',
  'bs':  BUILD_DIR + 'core_snes.js',
  'iso': BUILD_DIR + 'core_saturn.js',
  'ccd': BUILD_DIR + 'core_saturn.js',
};

// Extensions that could be PS1 or Saturn — trigger system picker
export const DISC_EXTS = new Set(['bin', 'cue', 'chd', 'img']);
export const N64_EXTS  = new Set(['z64', 'n64', 'v64']);

// ── Characters ───────────────────────────────────────────────
export const CHAR_NAMES = ['Cat', 'Incidental 70', 'Mech', 'Knight'];

// ── Gamepad display names ────────────────────────────────────
// Standard Gamepad API button index → human label
export const PAD_BTN_NAMES = [
  'A / Cross', 'B / Circle', 'X / Square', 'Y / Triangle',
  'LB / L1', 'RB / R1', 'LT / L2', 'RT / R2',
  'Select', 'Start', 'L3', 'R3',
  'D-Up', 'D-Down', 'D-Left', 'D-Right',
];

// Bindable libretro actions shown in the controls panel
export const RETRO_BINDABLE = [
  { id: RETRO.A,      label: 'A'       },
  { id: RETRO.B,      label: 'B'       },
  { id: RETRO.X,      label: 'X'       },
  { id: RETRO.Y,      label: 'Y'       },
  { id: RETRO.START,  label: 'Start'   },
  { id: RETRO.SELECT, label: 'Select'  },
  { id: RETRO.UP,     label: 'D-Up'    },
  { id: RETRO.DOWN,   label: 'D-Down'  },
  { id: RETRO.LEFT,   label: 'D-Left'  },
  { id: RETRO.RIGHT,  label: 'D-Right' },
  { id: RETRO.L,      label: 'L'       },
  { id: RETRO.R,      label: 'R'       },
  { id: RETRO.L2,     label: 'L2'      },
  { id: RETRO.R2,     label: 'R2'      },
];

// Default keyboard → libretro button bindings
export const DEFAULT_GAME_MAP = {
  'ArrowUp':    RETRO.UP,
  'ArrowDown':  RETRO.DOWN,
  'ArrowLeft':  RETRO.LEFT,
  'ArrowRight': RETRO.RIGHT,
  'Enter':      RETRO.START,
  'ShiftLeft':  RETRO.SELECT,
  'ShiftRight': RETRO.SELECT,
  'KeyZ':       RETRO.A,
  'KeyX':       RETRO.B,
  'KeyQ':       RETRO.L,
  'KeyE':       RETRO.R,
};

// Standard Gamepad API button → libretro button ID (default mapping)
export const DEFAULT_PAD_MAP = {
  0:  RETRO.A,       // A (south)
  1:  RETRO.B,       // B (east)
  2:  RETRO.X,       // X (west)
  3:  RETRO.Y,       // Y (north)
  4:  RETRO.L,       // L1
  5:  RETRO.R,       // R1
  6:  RETRO.L2,      // L2
  7:  RETRO.R2,      // R2
  8:  RETRO.SELECT,  // Select
  9:  RETRO.START,   // Start
  10: RETRO.L3,      // L3
  11: RETRO.R3,      // R3
  12: RETRO.UP,      // D-Up
  13: RETRO.DOWN,    // D-Down
  14: RETRO.LEFT,    // D-Left
  15: RETRO.RIGHT,   // D-Right
};
