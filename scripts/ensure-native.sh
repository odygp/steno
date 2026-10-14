#!/bin/bash
# Runs automatically before `npm run package`: if any native engine or model
# that gets bundled into the app is missing, run the full setup first.
set -e

for f in \
  lib/whisper.cpp/build/bin/whisper-cli \
  lib/whisper.cpp/build/bin/ggml-silero-v6.2.0.bin \
  lib/diarize/steno-diarize \
  lib/diarize/models/speaker-diarization
do
  if [ ! -e "$f" ]; then
    echo "→ $f is missing — running setup first…"
    exec bash scripts/setup-whisper.sh
  fi
done

echo "→ Native engines and models present."
