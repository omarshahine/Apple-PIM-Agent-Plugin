import Foundation

/// Writes PIM configuration and profile files to disk.
public struct ConfigWriter {

    /// Write the base configuration to `~/.config/apple-pim/config.json`.
    /// Creates the directory if it doesn't exist.
    public static func write(_ config: PIMConfiguration) throws {
        let dir = ConfigLoader.configDir
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)

        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let data = try encoder.encode(config)
        try data.write(to: ConfigLoader.defaultConfigPath)
    }

    /// Write a named profile to `~/.config/apple-pim/profiles/{name}.json`.
    /// Creates the profiles directory if it doesn't exist.
    public static func writeProfile(_ profile: PIMProfileOverride, named name: String) throws {
        let profileDir = ConfigLoader.profilesDir
        try FileManager.default.createDirectory(at: profileDir, withIntermediateDirectories: true)

        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let data = try encoder.encode(profile)
        try data.write(to: ConfigLoader.profilePath(for: name))
    }
}
