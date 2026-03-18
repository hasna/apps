// swift-tools-version:6.2
import PackageDescription

let package = Package(
  name: "EconomyBar",
  platforms: [.macOS(.v26)],
  products: [
    .executable(name: "EconomyBar", targets: ["EconomyBar"])
  ],
  targets: [
    .executableTarget(
      name: "EconomyBar",
      path: "Sources/EconomyBar"
    )
  ]
)
