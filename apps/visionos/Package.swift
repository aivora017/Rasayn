// swift-tools-version:5.10
// SCAFFOLD — Apple Vision Pro app for PharmaCare. Implement per ADR-0063.

import PackageDescription

let package = Package(
    name: "PharmaCareVisionOS",
    platforms: [.visionOS(.v2)],
    products: [.executable(name: "PharmaCareVisionOS", targets: ["PharmaCareVisionOS"])],
    targets: [
        .executableTarget(
            name: "PharmaCareVisionOS",
            path: "Sources/App"
        )
    ]
)
