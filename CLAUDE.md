# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Is

Retro Cube is a browser-based retro gaming emulator that renders classic games on a virtual CRT TV inside a 3D living room environment. Players move around in first-person. Emulator cores (GBC, GBA, SNES, PS1, N64) are compiled to WebAssembly via Emscripten. Multiplayer shows other players as animated cat avatars via WebRTC (PeerJS).

## Build

**Prerequisites:** Emscripten SDK must be installed and activated.

```bash
source /path/to/emsdk/emsdk_env.sh   # activate Emscripten
./build.sh                            # build all cores (GBC, GBA, SNES, PS1 + download N64)
```

`build.sh` clones emulator core repos into `/cores/`, builds each to a static `.a` library, then links with `frontend.cpp` to produce per-system bundles: `game_gbc.js/.wasm`, `game_snes.js/.wasm`, `game_ps1.js/.wasm`, `game_gba.js/.wasm`, and `n64wasm.js/.wasm`.

**Run locally:**
```bash
python3 -m http.server 8080
# open http://localhost:8080/index.html
```

There is no test suite.

## Architecture

The project has three layers:

### 1. `frontend.cpp` — C++ compiled to WebAssembly
The core engine (~1600 lines). Responsibilities:
- Loads and drives libretro emulator cores (`retro_init`, `retro_load_game`, `retro_run`)
- 3D scene rendering with OpenGL ES 3 / WebGL 2: parses glTF models (`cgltf`), manages a list of `TvPrim` draw calls, applies PBR-style lighting
- Lighting model: a warm ceiling lamp + 4 TV quadrant lights whose colors are sampled live from the game frame edges to simulate CRT glow
- CRT post-process: renders game frame to FBO with scanline/warp shader, composites onto TV screen geometry
- Skinned animation for the cat avatar (29-bone skeleton, keyframe sampling)
- First-person camera: `Player` struct with position + yaw/pitch; `RemotePlayer` structs for multiplayer avatars (up to 8)
- Audio: 16384-frame stereo ring buffer exposed to JS

**~40 exported functions** (`EMSCRIPTEN_KEEPALIVE`) are the JS↔C++ interface:
- `start_game(path)` — load ROM
- `set_button(id, pressed)` — gamepad input (16 buttons)
- `set_move_key(key, pressed)` / `add_mouse_delta(dx, dy)` — player movement
- `get_frame_ptr/w/h()` — video output
- `get_audio_buf_ptr()` — audio ring buffer
- `set_lamp_pos/intensity()`, `set_tv_quad_colors()`, `set_room_xform()`, `set_overscan()` — environment tuning
- `set_remote_player()`, `remove_remote_player()` — multiplayer

### 2. `index.html` — Browser JS (~900 lines inline)
- Manages the Emscripten module lifecycle (separate module per system)
- Reads video frames via `get_frame_ptr()` and uploads to WebGL textures each frame
- Web Audio API: pulls from `get_audio_buf_ptr()` ring buffer using `ScriptProcessorNode`
- Keyboard/mouse input forwarded to C++ via ccall
- PeerJS WebRTC: host streams canvas via `MediaStream`; guests send position data via data channel
- UI panels for ROM loading, BIOS files, lamp/room tuning sliders, multiplayer peer ID

### 3. `tv/` — 3D Assets
glTF models and PNG textures: `CRT_TV.gltf`, `crt_room_full.gltf`, `room.gltf`, `cat/scene.gltf`. Loaded by `cgltf` inside `frontend.cpp`; the `--preload-file tv` Emscripten flag bundles them into the `.data` file at build time.

## Key Build Flags (from `build.sh`)

- `-s FULL_ES3=1` — WebGL 2
- `-s EXPORTED_FUNCTIONS` — the ~40 C++ exports
- `-s INITIAL_MEMORY=67108864` (64 MB, PS1 uses 256 MB)
- `--preload-file tv` — bundles 3D assets into `.data` file
- `-O2 -std=c++17`

## Adding a New Emulator Core

Follow the pattern in `build.sh`: clone the libretro core repo into `cores/`, build it to a static `.a` with `emmake make`, then add an `emcc` link step in `build.sh` that produces a new `game_<system>.js/wasm` pair. The JS side in `index.html` selects which `.js` module to load based on file extension detected when the ROM is dropped.
