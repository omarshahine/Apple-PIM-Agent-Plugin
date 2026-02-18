import Foundation

/// Loads PIM configuration from disk with optional profile override.
///
/// Resolution order for profile selection:
/// 1. Explicit `profile` parameter (from `--profile` CLI flag)
/// 2. `APPLE_PIM_PROFILE` environment variable
/// 3. No profile — base config only
///
/// File locations:
/// - Base config: `~/.config/apple-pim/config.json`
/// - Profiles: `~/.config/apple-pim/profiles/{name}.json`
public struct ConfigLoader {

    /// Root directory for all PIM config files.
    public static var configDir: URL {
        FileManager.default.homeDirectoryForCurrentUser
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

        let override = loadProfile(named: profileName)
        if override == nil {
            // Log warning so the user knows the profile wasn't found
            FileHandle.standardError.write(
                Data("[apple-pim] Warning: profile '\(profileName)' not found at \(profilePath(for: profileName).path). Using base config.\n".utf8)
            )
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

    /// Path for a named profile.
    public static func profilePath(for name: String) -> URL {
        profilesDir.appendingPathComponent("\(name).json")
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
        guard let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(T.self, from: data)
    }
}
