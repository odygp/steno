// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "StenoDiarize",
    platforms: [.macOS(.v14)],
    dependencies: [
        .package(url: "https://github.com/FluidInference/FluidAudio.git", exact: "0.17.7"),
    ],
    targets: [
        .executableTarget(
            name: "steno-diarize",
            dependencies: [.product(name: "FluidAudio", package: "FluidAudio")]
        ),
    ]
)
