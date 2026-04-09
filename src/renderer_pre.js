// Injected before Emscripten's Module init via --pre-js.
// Tells the file packager to look in build/ for .data and .wasm files.
Module['locateFile'] = Module['locateFile'] || function(path) {
  return 'build/' + path;
};
