// swift-tools-version:6.0
import PackageDescription

let package = Package(
  name: "EconomyBar",
  platforms: [.macOS(.v15)],
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
