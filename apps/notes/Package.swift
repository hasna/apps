// swift-tools-version:6.0
import PackageDescription

let package = Package(
    name: "HasnaNotes",
    platforms: [.macOS("26.0")],
    products: [
        .library(name: "HasnaNotesCore", targets: ["HasnaNotesCore"]),
    ],
    targets: [
        .target(
            name: "HasnaNotesCore",
            path: "Sources/HasnaNotesCore"
        ),
        // CLI smoke test for the markdown store. Used as the verification harness
        // because XCTest / swift-testing are unavailable under Command Line Tools.
        .executableTarget(
            name: "HasnaNotesSmoke",
            dependencies: ["HasnaNotesCore"],
            path: "Sources/HasnaNotesSmoke"
        ),
        // Native macOS shell (WKWebView) hosting the bundled web UI.
        // Depends on HasnaNotesCore so it can read/write the on-disk Markdown notes
        // store and bridge real note data into the web UI.
        .executableTarget(
            name: "HasnaNotesApp",
            dependencies: ["HasnaNotesCore"],
            path: "Sources/HasnaNotesApp"
        ),
    ]
)
