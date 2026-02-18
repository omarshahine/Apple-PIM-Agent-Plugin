import Foundation

/// Errors from loading or validating PIM configuration.
public enum ConfigError: Error, CustomStringConvertible {
    case invalidProfileName(String, reason: String)
    case malformedConfig(path: String, underlying: Error)

    public var description: String {
        switch self {
        case .invalidProfileName(let name, let reason):
            return "Invalid profile name '\(name)': \(reason)"
        case .malformedConfig(let path, let underlying):
            return "Malformed config at \(path): \(underlying.localizedDescription)"
        }
    }
}

/// Loads PIM configuration from disk with optional profile override.
///
/// Resolution order for profile selection:
/// 1. Explicit `profile` parameter (from `--profile` CLI flag)
/// 2. `APPLE_PIM_PROFILE` environment variable
/// 3. No profile — base config only
///
/// File locations (default, overridable via `APPLE_PIM_CONFIG_DIR`):
/// - Base config: `~/.config/apple-pim/config.json`
/// - Profiles: `~/.config/apple-pim/profiles/{name}.json`
public struct ConfigLoader {

    /// Root directory for all PIM config files.
    /// Override with the `APPLE_PIM_CONFIG_DIR` environment variable.
    public static var configDir: URL {
        if let dir = ProcessInfo.processInfo.environment["APPLE_PIM_CONFIG_DIR"], !dir.isEmpty {
            return URL(fileURLWithPath: dir)
        }
        return FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".config/apple-pim")
    }

    /// Path to the default (base) configuration file.
    public static var defaultConfigPath: URL {
        configDir.appendingPathComponent("config.json")
    }

    /// Directory containing named profiles.
    public static var profilesDir: URL {
        configDir.appendingPathComponent("profiles")
    }

    /// Load the resolved configuration.
    ///
    /// - Parameter profile: Optional profile name. If nil, checks `APPLE_PIM_PROFILE` env var.
    /// - Returns: The merged configuration (base + profile override).
    public static func load(profile: String? = nil) -> PIMConfiguration {
        let base = loadBaseConfig()

        let profileName = profile ?? ProcessInfo.processInfo.environment["APPLE_PIM_PROFILE"]
        guard let profileName, !profileName.isEmpty else {
            return base
        }

        do {
            try validateProfileName(profileName)
        } catch {
            FileHandle.standardError.write(
                Data("[apple-pim] Error: \(error). Refusing to fall back to base config.\n".utf8)
            )
            Foundation.exit(1)
        }

        let override = loadProfile(named: profileName)
        if override == nil {
            // Fail closed: explicit profile not found is an error, not a warning
            FileHandle.standardError.write(
                Data("[apple-pim] Error: profile '\(profileName)' not found at \(profilePath(for: profileName).path). Refusing to fall back to base config.\n".utf8)
            )
            Foundation.exit(1)
        }
        return merge(base: base, profile: override)
    }

    /// Load just the base config (no profile). Returns all-access defaults if file is missing or invalid.
    public static func loadBaseConfig() -> PIMConfiguration {
        return loadJSON(from: defaultConfigPath) ?? PIMConfiguration()
    }

    /// Load a named profile override. Returns nil if file is missing or invalid.
    public static func loadProfile(named name: String) -> PIMProfileOverride? {
        return loadJSON(from: profilePath(for: name))
    }

    /// Validate that a profile name is safe for use as a filename.
    /// Rejects names containing path separators or traversal sequences.
    public static func validateProfileName(_ name: String) throws {
        guard !name.isEmpty else {
            throw ConfigError.invalidProfileName(name, reason: "name cannot be empty")
        }
        guard !name.contains("/"), !name.contains("\\"), !name.contains("..") else {
            throw ConfigError.invalidProfileName(name, reason: "name cannot contain '/', '\\', or '..'")
        }
        // Reject hidden files and other problematic names
        guard !name.hasPrefix(".") else {
            throw ConfigError.invalidProfileName(name, reason: "name cannot start with '.'")
        }
    }

    /// Path for a named profile. Validates the name to prevent path traversal.
    public static func profilePath(for name: String) -> URL {
        // Use lastPathComponent to strip any accidental path separators as a defense-in-depth
        let safeName = (name as NSString).lastPathComponent
        return profilesDir.appendingPathComponent("\(safeName).json")
    }

    /// Merge a base config with an optional profile override.
    /// Non-nil profile fields replace the corresponding base fields entirely.
    public static func merge(base: PIMConfiguration, profile: PIMProfileOverride?) -> PIMConfiguration {
        guard let profile else { return base }

        var merged = base
        if let calendars = profile.calendars { merged.calendars = calendars }
        if let reminders = profile.reminders { merged.reminders = reminders }
        if let contacts = profile.contacts { merged.contacts = contacts }
        if let mail = profile.mail { merged.mail = mail }
        if let defaultCalendar = profile.defaultCalendar { merged.defaultCalendar = defaultCalendar }
        if let defaultReminderList = profile.defaultReminderList { merged.defaultReminderList = defaultReminderList }
        return merged
    }

    // MARK: - Private

    private static func loadJSON<T: Decodable>(from url: URL) -> T? {
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }

        do {
            let data = try Data(contentsOf: url)
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            FileHandle.standardError.write(
                Data("[apple-pim] Warning: failed to parse \(url.path): \(error.localizedDescription). Using defaults.\n".utf8)
            )
            return nil
        }
    }
}
