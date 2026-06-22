// swift-tools-version: 5.9

import PackageDescription

let package = Package(
    name: "OpenKnowledge",
    platforms: [
        .macOS(.v13)
    ],
    products: [
        .executable(name: "OpenKnowledge", targets: ["OpenKnowledgeApp"])
    ],
    targets: [
        .executableTarget(
            name: "OpenKnowledgeApp",
            path: "Sources/OpenKnowledgeApp"
        )
    ]
)
