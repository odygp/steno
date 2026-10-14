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

# ── Voice activity detection model (skips silence, which whisper hallucinates over) ──
if [ ! -f build/bin/ggml-silero-v6.2.0.bin ]; then
  echo "→ Downloading Silero VAD model (~1 MB)…"
  curl -L --progress-bar -o build/bin/ggml-silero-v6.2.0.bin \
    "https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v6.2.0.bin"
fi

cd ../..

# ── Speaker identification (sherpa-onnx) ──
# Prebuilt binary + onnxruntime, plus a pyannote segmentation model and a
# wespeaker voice-embedding model. The binary finds libonnxruntime.dylib next
# to itself via its @loader_path rpath, so everything lives in one folder.

SHERPA_VERSION=1.13.8
SHERPA_DIR=lib/sherpa-onnx
SHERPA_URL=https://github.com/k2-fsa/sherpa-onnx/releases/download

if [ ! -f "$SHERPA_DIR/sherpa-onnx-offline-speaker-diarization" ]; then
  echo "→ Downloading sherpa-onnx $SHERPA_VERSION (speaker identification)…"
  mkdir -p "$SHERPA_DIR"
  tmp=$(mktemp -d)
  pkg="sherpa-onnx-v$SHERPA_VERSION-osx-arm64-shared-no-tts"
  curl -L --progress-bar -o "$tmp/$pkg.tar.bz2" "$SHERPA_URL/v$SHERPA_VERSION/$pkg.tar.bz2"
  tar xjf "$tmp/$pkg.tar.bz2" -C "$tmp"
  cp "$tmp/$pkg/bin/sherpa-onnx-offline-speaker-diarization" "$SHERPA_DIR/"
  cp "$tmp/$pkg/lib/libonnxruntime.dylib" "$SHERPA_DIR/"

  curl -L --progress-bar -o "$tmp/seg.tar.bz2" \
    "$SHERPA_URL/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2"
  tar xjf "$tmp/seg.tar.bz2" -C "$tmp"
  cp "$tmp/sherpa-onnx-pyannote-segmentation-3-0/model.onnx" "$SHERPA_DIR/segmentation.onnx"

  curl -L --progress-bar -o "$SHERPA_DIR/embedding.onnx" \
    "$SHERPA_URL/speaker-recongition-models/wespeaker_en_voxceleb_resnet34_LM.onnx"
  echo "e9848563da86f263117134dfd7ad63c92355b37de492b55e325400c9d9c39012  $SHERPA_DIR/embedding.onnx" | shasum -a 256 -c

  rm -rf "$tmp"
else
  echo "→ sherpa-onnx already installed."
fi

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
