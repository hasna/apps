// swift-tools-version:5.9
import PackageDescription

let package = Package(
  name: "EconomyBar",
  platforms: [.macOS(.v14)],
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
