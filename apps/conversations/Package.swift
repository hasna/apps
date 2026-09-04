// swift-tools-version:6.0
import PackageDescription

let package = Package(
    name: "HasnaConversations",
    // Deployment floor, not the version we develop on. The app guards the one
    // API it uses that is newer than this (`isInspectable`, macOS 13.3), and the
    // floor has to be reachable by a GitHub-hosted macOS runner or the CI job
    // that compiles this package cannot run at all.
    platforms: [.macOS(.v13)],
    targets: [
        // Store resolution, split out of the app so it can be tested. It imports
        // Foundation only — no AppKit, no WebKit — which is what makes a test
        // target possible; deciding which store the bundled server will use is a
        // pure function of the environment and one config file.
        .target(
            name: "HasnaConversationsCore",
            path: "Sources/HasnaConversationsCore"
        ),
        // Native macOS shell (WKWebView). It spawns the conversations local
        // HTTP server (bun) on a loopback port; the bundled web UI was removed,
        // so the server's /api/* and /health routes are the client surface.
        .executableTarget(
            name: "HasnaConversationsApp",
            dependencies: ["HasnaConversationsCore"],
            path: "Sources/HasnaConversationsApp"
        ),
        .testTarget(
            name: "HasnaConversationsCoreTests",
            dependencies: ["HasnaConversationsCore"],
            path: "Tests/HasnaConversationsCoreTests"
        ),
    ]
)
