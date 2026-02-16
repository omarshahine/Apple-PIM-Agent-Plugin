// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "ApplePIMTools",
    platforms: [
        .macOS(.v13)
    ],
    products: [
        .executable(name: "calendar-cli", targets: ["CalendarCLI"]),
        .executable(name: "reminder-cli", targets: ["ReminderCLI"]),
        .executable(name: "contacts-cli", targets: ["ContactsCLI"]),
        .executable(name: "mail-cli", targets: ["MailCLI"]),
    ],
    dependencies: [
        .package(url: "https://github.com/apple/swift-argument-parser.git", from: "1.3.0"),
    ],
    targets: [
        .executableTarget(
            name: "CalendarCLI",
            dependencies: [
                .product(name: "ArgumentParser", package: "swift-argument-parser"),
            ],
            path: "Sources/CalendarCLI"
        ),
        .executableTarget(
            name: "ReminderCLI",
            dependencies: [
                .product(name: "ArgumentParser", package: "swift-argument-parser"),
            ],
            path: "Sources/ReminderCLI"
        ),
        .executableTarget(
            name: "ContactsCLI",
            dependencies: [
                .product(name: "ArgumentParser", package: "swift-argument-parser"),
            ],
            path: "Sources/ContactsCLI"
        ),
        .executableTarget(
            name: "MailCLI",
            dependencies: [
                .product(name: "ArgumentParser", package: "swift-argument-parser"),
            ],
            path: "Sources/MailCLI"
        ),
        .testTarget(
            name: "CalendarCLITests",
            dependencies: ["CalendarCLI"],
            path: "Tests/CalendarCLITests"
        ),
        .testTarget(
            name: "ReminderCLITests",
            dependencies: ["ReminderCLI"],
            path: "Tests/ReminderCLITests"
        ),
        .testTarget(
            name: "ContactsCLITests",
            dependencies: ["ContactsCLI"],
            path: "Tests/ContactsCLITests"
        ),
        .testTarget(
            name: "MailCLITests",
            dependencies: ["MailCLI"],
            path: "Tests/MailCLITests"
        ),
    ]
)
