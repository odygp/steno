#!/bin/bash
set -e

echo ""
echo "  ╭──────────────────────────────────╮"
echo "  │   steno · whisper.cpp setup      │"
echo "  ╰──────────────────────────────────╯"
echo ""

# ── Check for required system tools ──

if ! command -v ffmpeg &> /dev/null; then
  echo "→ ffmpeg not found. Installing via Homebrew…"
  brew install ffmpeg
fi

if ! command -v cmake &> /dev/null; then
  echo "→ cmake not found. Installing via Homebrew…"
  brew install cmake
fi

# ── Clone whisper.cpp ──

if [ ! -d "lib/whisper.cpp" ]; then
  echo "→ Cloning whisper.cpp…"
  git clone https://github.com/ggerganov/whisper.cpp.git lib/whisper.cpp
else
  echo "→ whisper.cpp already cloned."
fi

# ── Build whisper.cpp with Apple Silicon optimizations ──

echo "→ Building whisper.cpp (Apple Silicon)…"
cd lib/whisper.cpp

cmake -B build \
  -DWHISPER_COREML=OFF \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_OSX_DEPLOYMENT_TARGET=13.0

cmake --build build --config Release -j$(sysctl -n hw.ncpu)

# ── Collect shared libraries next to the binary ──
echo "→ Collecting shared libraries into build/bin/…"
cp build/src/libwhisper*.dylib build/bin/ 2>/dev/null || true
cp build/ggml/src/libggml*.dylib build/bin/ 2>/dev/null || true
cp build/ggml/src/ggml-metal/libggml-metal*.dylib build/bin/ 2>/dev/null || true
cp build/ggml/src/ggml-blas/libggml-blas*.dylib build/bin/ 2>/dev/null || true
cp build/ggml/src/ggml-cpu/libggml-cpu*.dylib build/bin/ 2>/dev/null || true

# ── Fix rpaths so binaries find dylibs next to themselves ──
echo "→ Patching library paths for portability…"
cd build/bin

# Remove all existing rpaths from whisper-cli and add @executable_path/
for rpath in $(otool -l whisper-cli | grep -A2 LC_RPATH | grep "path " | awk '{print $2}'); do
  install_name_tool -delete_rpath "$rpath" whisper-cli 2>/dev/null || true
done
install_name_tool -add_rpath @executable_path/ whisper-cli 2>/dev/null || true

# Rewrite @rpath → @loader_path in all dylibs so they find each other
for dylib in *.dylib; do
  # Remove all existing rpaths
  for rpath in $(otool -l "$dylib" | grep -A2 LC_RPATH | grep "path " | awk '{print $2}'); do
    install_name_tool -delete_rpath "$rpath" "$dylib" 2>/dev/null || true
  done
  install_name_tool -add_rpath @loader_path/ "$dylib" 2>/dev/null || true

  # Rewrite install name to use @loader_path
  old_id=$(otool -D "$dylib" | tail -1)
  if [[ "$old_id" == @rpath/* ]]; then
    base=$(basename "$old_id")
    install_name_tool -id "@loader_path/$base" "$dylib" 2>/dev/null || true
  fi
done

cd ../..

cd ../..

# ── Download the base model ──

if [ ! -f "models/ggml-base.bin" ]; then
  echo "→ Downloading Whisper base model (~148 MB)…"
  mkdir -p models
  curl -L --progress-bar \
    -o models/ggml-base.bin \
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin"
else
  echo "→ Model already downloaded."
fi

echo ""
echo "  ✓ Setup complete. Run: npm run dev"
echo ""
