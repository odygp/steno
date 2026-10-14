// Speaker diarization helper for Steno, built on FluidAudio's offline
// pyannote Community-1 pipeline (powerset segmentation + WeSpeaker + VBx).
//
//   steno-diarize prepare <models-dir>                  download models (setup time)
//   steno-diarize <models-dir> <audio.wav> [speakers]   print speaker turns
//
// Turns go to stdout as "<from> -- <to> speaker_NN" (seconds), progress to
// stderr as "progress NN%".

import CoreML
import Foundation
import FluidAudio

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data("\(message)\n".utf8))
    exit(1)
}

let args = CommandLine.arguments

if args.count == 3, args[1] == "prepare" {
    do {
        _ = try await OfflineDiarizerModels.load(from: URL(fileURLWithPath: args[2]))
        print("models ready")
        exit(0)
    } catch {
        fail("Failed to download models: \(error.localizedDescription)")
    }
}

guard args.count == 3 || args.count == 4 else {
    fail("usage: steno-diarize <models-dir> <audio.wav> [speakers]")
}

var config = OfflineDiarizerConfig.default
// Keep short interjections ("ok", "right") — the default drops anything under 1 s
config.embedding.minSegmentDurationSeconds = 0.2
if args.count == 4, let speakers = Int(args[3]), speakers > 0 {
    config = config.withSpeakers(exactly: speakers)
}

do {
    // Models ship inside the app, so load them directly: prepareModels() would
    // delete and re-download into the (read-only, signed) bundle on failure.
    let models = try await OfflineDiarizerModels.load(from: URL(fileURLWithPath: args[1]))
    let manager = OfflineDiarizerManager(config: config)
    manager.initialize(models: models)

    let result = try await manager.process(URL(fileURLWithPath: args[2])) { done, total in
        FileHandle.standardError.write(Data("progress \(done * 100 / max(total, 1))%\n".utf8))
    }

    for segment in result.segments {
        let id = Int(segment.speakerId.drop(while: { !$0.isNumber })) ?? 0
        print(String(format: "%.3f -- %.3f speaker_%02d", segment.startTimeSeconds, segment.endTimeSeconds, id))
    }
} catch {
    fail("Speaker identification failed: \(error.localizedDescription)")
}
