// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "NotesLib",
    platforms: [.macOS(.v13), .iOS(.v16)],
    products: [.library(name: "NotesLib", targets: ["NotesLib"])],
    targets: [
        .target(name: "NotesLib"),
        .executableTarget(name: "NotesLibConformance", dependencies: ["NotesLib"], path: "Tests/NotesLibTests", resources: [.copy("Fixtures")])
    ]
)
