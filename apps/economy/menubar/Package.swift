// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "EconomyMenubar",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(
            name: "EconomyMenubar",
            path: "Sources",
            swiftSettings: [.unsafeFlags(["-swift-version", "5"])]
        )
    ]
)
