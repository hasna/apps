// swift-tools-version:6.0
import PackageDescription

let package = Package(
    name: "PersonalNotes",
    platforms: [.macOS("26.0")],
    products: [
        .library(name: "PersonalNotesCore", targets: ["PersonalNotesCore"]),
    ],
    targets: [
        .target(
            name: "PersonalNotesCore",
            path: "Sources/PersonalNotesCore"
        ),
        // CLI smoke test for the markdown store. Used as the verification harness
        // because XCTest / swift-testing are unavailable under Command Line Tools.
        .executableTarget(
            name: "PersonalNotesSmoke",
            dependencies: ["PersonalNotesCore"],
            path: "Sources/PersonalNotesSmoke"
        ),
        // Native macOS shell (WKWebView) hosting the bundled web UI.
        // Depends on PersonalNotesCore so it can read/write the on-disk Markdown notes
        // store and bridge real note data into the web UI.
        .executableTarget(
            name: "PersonalNotesApp",
            dependencies: ["PersonalNotesCore"],
            path: "Sources/PersonalNotesApp"
        ),
    ]
)
