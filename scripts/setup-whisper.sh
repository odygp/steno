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
  -DCMAKE_BUILD_TYPE=Release

cmake --build build --config Release -j$(sysctl -n hw.ncpu)

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
