# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Is

Retro Cube is a browser-based retro gaming emulator that renders classic games on a virtual CRT TV inside a 3D living room environment. Players move around in first-person. Emulator cores (GBC, GBA, SNES, PS1, N64) are compiled to WebAssembly via Emscripten. Multiplayer shows other players as animated cat avatars via WebRTC (PeerJS).

## Directory Layout

```
src/           — C++ source (compiled to WASM by build.sh)
js/            — Browser JS modules (served directly, no build step)
build/         — Compiled output: .js/.wasm/.data bundles (gitignored)
tv/            — 3D assets: glTF models + PNG textures (bundled into build/)
include/       — Third-party C headers (libretro.h, cgltf.h, stb_image.h)
cores/         — Cloned libretro core repos (gitignored, fetched by build.sh)
index.html     — HTML entry point
```

## Build

**Prerequisites:** Emscripten SDK must be installed and activated.

```bash
source /path/to/emsdk/emsdk_env.sh   # activate Emscripten
./build.sh                            # build all cores + download N64
```

`build.sh` clones emulator core repos into `cores/`, builds each to a static `.a` library, then compiles and links `src/` C++ files to produce per-system bundles in `build/`: `game_renderer.js`, `core_gbc.js/.wasm`, `core_snes.js/.wasm`, `core_ps1.js/.wasm`, `core_gba.js/.wasm`. N64 (`n64wasm.js/.wasm`) is downloaded prebuilt — see N64 note below.

**Run locally:**
```bash
python3 -m http.server 8080
# open http://localhost:8080/index.html
```

There is no test suite.

## Architecture

### 1. C++ Layer (`src/`)

Split across multiple translation units compiled separately and linked into `build/game_renderer.js`:

| File | Role |
|------|------|
| `renderer.cpp` | Global state definitions, GL init, ~30 exported `EMSCRIPTEN_KEEPALIVE` functions (JS↔C++ API), main loop |
| `renderer_types.h` | Shared header: all struct definitions, constants, `extern` global declarations, function prototypes |
| `renderer_shaders.h` | GLSL shader source strings (`inline const char*`, C++17) |
| `renderer_math.cpp` | Column-major 4x4 matrix math, quaternion slerp |
| `renderer_gl_utils.cpp` | Shader compilation, texture loading (owns `STB_IMAGE_IMPLEMENTATION`) |
| `renderer_scene.cpp` | glTF scene loaders: TV, room, skinned avatars (owns `CGLTF_IMPLEMENTATION`) |
| `renderer_crt.cpp` | CRT post-process: FBO init, scanline/warp shader pass |
| `renderer_anim.cpp` | Skeletal animation: keyframe sampling, bone matrix computation |
| `renderer_render.cpp` | Player movement, static scene rendering, avatar rendering, preview mode |
| `core.cpp` | Libretro core driver: loads/runs cores, pixel format conversion, audio ring buffer |

**Key exported functions** (`EMSCRIPTEN_KEEPALIVE`) are the JS↔C++ interface:
- `start_game(path)` — load ROM
- `set_button(id, pressed)` — gamepad input (16 buttons)
- `set_move_key(key, pressed)` / `add_mouse_delta(dx, dy)` — player movement
- `get_frame_ptr/w/h()` — video output
- `get_audio_buf_ptr()` — audio ring buffer
- `set_lamp_pos/intensity()`, `set_tv_quad_colors()`, `set_room_xform()`, `set_overscan()` — environment tuning
- `set_remote_player()`, `remove_remote_player()` — multiplayer

### 2. Browser JS (`js/`)

All JS modules use ES module imports. Only `js/app.js` is loaded from HTML; all others are imported transitively.

| File | Role |
|------|------|
| `app.js` | Entry point (~100 lines): canvas sizing, renderer loading, module initialization |
| `config.js` | All constants: magic numbers, core routing map, input defaults, `BUILD_DIR` path |
| `renderer.js` | Typed wrapper over Emscripten `ccall()` — single point of coupling to C++ |
| `state.js` | Observable shared state with `setState()` / `onStateChange()` |
| `screens.js` | Screen state machine: landing → carousel (character select) → room |
| `settings-ui.js` | All slider wiring for scene, lighting, audio settings |
| `controls-ui.js` | Key bindings panel: rebinding UI for libretro and N64 controls |
| `rom-loader.js` | ROM dispatch, disc picker modal, BIOS file handling, core availability checks |
| `audio.js` | AudioContext lifecycle, spatial PannerNode, ring buffer drain, listener position sync |
| `worker-bridge.js` | Worker lifecycle, frame/audio receive, quad-color sampling |
| `input.js` | Keyboard/mouse/gamepad handlers, WASD movement + game button dispatch |
| `multiplayer.js` | PeerJS WebRTC: host/join, position sync, video stream, scene broadcast |
| `n64.js` | N64-specific loading path (see N64 note below) |
| `n64-bindings.js` | N64 key/gamepad bindings, config.txt generation |
| `virtual-gamepad.js` | Monkey-patched `navigator.getGamepads()` for N64 guest input |
| `utils.js` | Shared UI utilities |
| `core_worker.js` | Web Worker shell that hosts any libretro core bundle |

**Key abstractions:**
- **`renderer.js`** wraps all C++ calls — no other JS module touches `ccall()` directly
- **`config.js`** centralizes all constants — no magic numbers in logic code
- **`state.js`** provides `setState(key, value)` with change notification

#### Renderer / Core Split

- **`src/renderer.cpp`** → **`build/game_renderer.js`**: loads on page open, owns the 3D scene, WebGL context, and player movement. No emulation logic.
- **`src/core.cpp`** → **`build/core_*.js`**: one bundle per system, loaded inside `core_worker.js` as a Web Worker when a ROM is dropped. Owns all libretro emulation. Sends frames + audio back to the main thread via transferable `ArrayBuffer`s.

#### N64 — Separate Code Path

**N64 does not use the libretro/Worker architecture.** It uses a completely different emulator: [nbarkhina/N64Wasm](https://github.com/nbarkhina/N64Wasm), which is downloaded prebuilt. Key differences from the other cores:

- Runs on the **main thread** (not a Worker) via an IIFE, with its own offscreen `<canvas id="n64canvas">`
- Uses SDL internally, fires its own `requestAnimationFrame` loop, and writes directly to a WebGL context
- Requires `assets.zip` and `config.txt` written to its virtual filesystem before `callMain()`
- Frames are copied from `n64canvas` → a 2D blit canvas → the main WebGL texture each frame

This is why `js/n64.js` exists as a standalone module rather than routing through `core_worker.js`.

### 3. 3D Assets (`tv/`)

glTF models and PNG textures: `CRT_TV.gltf`, `crt_room_full.gltf`, `room.gltf`, `cat/scene.gltf`. Loaded by `cgltf` inside `renderer_scene.cpp`; the `--preload-file tv` Emscripten flag bundles them into the `.data` file at build time.

## Key Build Flags (from `build.sh`)

- `-s FULL_ES3=1` — WebGL 2
- `-s EXPORTED_FUNCTIONS` — the ~30 C++ exports
- `-s INITIAL_MEMORY=67108864` (64 MB, PS1 uses 256 MB)
- `--preload-file tv` — bundles 3D assets into `.data` file
- `-O2 -std=c++17`

## Adding a New Emulator Core

Follow the pattern in `build.sh`: clone the libretro core repo into `cores/`, build it to a static `.a` with `emmake make`, then add an `em++` link step that compiles `src/core.cpp` with the new `.a` to produce a new `build/core_<system>.js/.wasm` pair (use `-s ENVIRONMENT=worker`). Then in `js/config.js`, add the new file extensions to `CORE_MAP` mapping them to the new bundle name. `core_worker.js` handles all libretro cores generically — no changes needed there.
