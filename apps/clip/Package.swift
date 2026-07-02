// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "OpenClip",
    platforms: [
        .macOS(.v13)
    ],
    products: [
        .executable(name: "OpenClip", targets: ["ClipMenuBar"]),
        .executable(name: "ClipSmoke", targets: ["ClipSmoke"])
    ],
    targets: [
        .target(name: "ClipCore"),
        .executableTarget(
            name: "ClipMenuBar",
            dependencies: ["ClipCore"]
        ),
        .executableTarget(
            name: "ClipSmoke",
            dependencies: ["ClipCore"]
        )
    ]
)
