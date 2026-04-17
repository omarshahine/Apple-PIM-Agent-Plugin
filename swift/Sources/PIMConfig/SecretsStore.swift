import Foundation

/// Errors from reading, writing, or resolving secrets.
public enum SecretsError: Error, CustomStringConvertible {
    case invalidKey(String, reason: String)
    case writeFailed(path: String, underlying: Error)
    case notFound(key: String)
    case malformedStore(path: String, underlying: Error)

    public var description: String {
        switch self {
        case .invalidKey(let key, let reason):
            return "Invalid secret key '\(key)': \(reason)"
        case .writeFailed(let path, let underlying):
            return "Failed to write secret to \(path): \(underlying.localizedDescription)"
        case .notFound(let key):
            return "Secret '\(key)' not found in any store"
        case .malformedStore(let path, let underlying):
            return "Malformed secrets store at \(path): \(underlying.localizedDescription)"
        }
    }
}

/// Which backing store to target for read or write operations.
public enum SecretsStoreKind: String, CaseIterable, Sendable {
    /// `~/.openclaw/secrets.json`. Shared with the OpenClaw gateway.
    case openclaw
    /// `~/.config/apple-pim/secrets.json`. Managed solely by this CLI.
    case standalone
    /// Resolve automatically: prefer the store that already owns the key;
    /// on write, prefer `openclaw` if the file exists, else `standalone`.
    case auto
}

/// Reads and writes secrets using JSON-pointer addressing.
///
/// A secret key is a dot-separated path like `smtp.icloud.password`, which maps
/// to the JSON pointer `/smtp/icloud/password` inside the backing JSON file.
///
/// Read resolution order:
/// 1. Environment variable (`smtp.icloud.password` → `SMTP_ICLOUD_PASSWORD`)
/// 2. `~/.openclaw/secrets.json` at the matching JSON pointer
/// 3. `~/.config/apple-pim/secrets.json` at the matching JSON pointer
///
/// Both files are expected at mode 0600. A warning is emitted on stderr if the
/// permissions are wider than that (common after `scp` or a home-directory restore).
public struct SecretsStore: Sendable {

    /// Path to the OpenClaw shared secrets file.
    /// Override for tests via `OPENCLAW_SECRETS_PATH`.
    public static var openclawPath: URL {
        if let p = ProcessInfo.processInfo.environment["OPENCLAW_SECRETS_PATH"], !p.isEmpty {
            return URL(fileURLWithPath: p)
        }
        return FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".openclaw/secrets.json")
    }

    /// Path to the standalone apple-pim secrets file.
    /// Uses `APPLE_PIM_CONFIG_DIR` as its parent when set (for tests), else `~/.config/apple-pim`.
    public static var standalonePath: URL {
        ConfigLoader.configDir.appendingPathComponent("secrets.json")
    }

    /// URL for the given store kind. `.auto` resolves to `.standalone` for file-path purposes.
    public static func path(for kind: SecretsStoreKind) -> URL {
        switch kind {
        case .openclaw: return openclawPath
        case .standalone, .auto: return standalonePath
        }
    }

    /// Environment-variable name corresponding to a dotted key.
    /// `smtp.icloud.password` → `SMTP_ICLOUD_PASSWORD`.
    public static func envVarName(for key: String) -> String {
        key.uppercased().replacingOccurrences(of: ".", with: "_")
    }

    // MARK: - Public API

    /// Resolve a secret by key using the full precedence order (env → openclaw → standalone).
    /// Returns `nil` if not found in any store.
    public static func resolve(_ key: String) -> String? {
        do { try validateKey(key) } catch { return nil }

        if let env = ProcessInfo.processInfo.environment[envVarName(for: key)], !env.isEmpty {
            return env
        }
        for kind in [SecretsStoreKind.openclaw, .standalone] {
            if let v = try? read(key, from: kind) { return v }
        }
        return nil
    }

    /// Read a secret from a specific store.
    /// Throws `.notFound` if the key is absent; `.malformedStore` if the JSON is bad.
    public static func read(_ key: String, from kind: SecretsStoreKind) throws -> String {
        try validateKey(key)
        let url = path(for: kind)
        let dict = try loadStore(at: url)
        let segments = pointerSegments(from: key)
        guard let value = walkPointer(segments, in: dict) as? String else {
            throw SecretsError.notFound(key: key)
        }
        return value
    }

    /// List all keys (dotted form) present in the given store.
    /// Returns an empty array if the store doesn't exist.
    /// Values are never included — this is deliberate, use `read` for that.
    public static func list(from kind: SecretsStoreKind) throws -> [String] {
        let url = path(for: kind)
        guard FileManager.default.fileExists(atPath: url.path) else { return [] }
        let dict = try loadStore(at: url)
        return flatten(dict, prefix: "").sorted()
    }

    /// Write a secret to the specified store (atomic, 0600).
    /// For `.auto`: writes to whichever store already owns the key, else standalone.
    @discardableResult
    public static func write(_ key: String, value: String, to kind: SecretsStoreKind = .auto) throws -> SecretsStoreKind {
        try validateKey(key)
        let resolved = try resolveWriteTarget(key: key, requested: kind)
        let url = path(for: resolved)

        let dir = url.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        if resolved == .standalone {
            dropSpotlightMarker(in: dir)
        }

        var dict = (try? loadStore(at: url)) ?? [:]
        let segments = pointerSegments(from: key)
        insertPointer(segments, value: value, in: &dict)
        try atomicWriteJSON(dict, to: url)
        return resolved
    }

    /// Remove a secret from the specified store. Returns true if something was removed.
    /// For `.auto`: removes from whichever store owns it; if none do, returns false.
    @discardableResult
    public static func unset(_ key: String, from kind: SecretsStoreKind = .auto) throws -> Bool {
        try validateKey(key)
        let targets: [SecretsStoreKind]
        switch kind {
        case .auto: targets = [.openclaw, .standalone]
        default:    targets = [kind]
        }
        var removed = false
        for target in targets {
            let url = path(for: target)
            guard FileManager.default.fileExists(atPath: url.path) else { continue }
            var dict = try loadStore(at: url)
            let segments = pointerSegments(from: key)
            if removePointer(segments, in: &dict) {
                try atomicWriteJSON(dict, to: url)
                removed = true
            }
        }
        return removed
    }

    // MARK: - Key / pointer helpers

    /// A dotted key is valid when it is non-empty, contains no empty segments,
    /// and every character is `[A-Za-z0-9_.-]`. This matches the shape of
    /// identifiers we've put in both stores and rules out path-traversal or
    /// accidental-env-var-shadowing surprises.
    public static func validateKey(_ key: String) throws {
        guard !key.isEmpty else {
            throw SecretsError.invalidKey(key, reason: "key cannot be empty")
        }
        guard !key.hasPrefix("."), !key.hasSuffix("."), !key.contains("..") else {
            throw SecretsError.invalidKey(key, reason: "dotted segments must be non-empty")
        }
        let allowed = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-.")
        guard key.unicodeScalars.allSatisfy({ allowed.contains($0) }) else {
            throw SecretsError.invalidKey(key, reason: "only [A-Za-z0-9_.-] allowed")
        }
    }

    static func pointerSegments(from key: String) -> [String] {
        key.split(separator: ".").map(String.init)
    }

    static func walkPointer(_ segments: [String], in dict: [String: Any]) -> Any? {
        var current: Any = dict
        for seg in segments {
            guard let d = current as? [String: Any], let next = d[seg] else { return nil }
            current = next
        }
        return current
    }

    static func insertPointer(_ segments: [String], value: String, in dict: inout [String: Any]) {
        guard let first = segments.first else { return }
        if segments.count == 1 {
            dict[first] = value
            return
        }
        var child = dict[first] as? [String: Any] ?? [:]
        insertPointer(Array(segments.dropFirst()), value: value, in: &child)
        dict[first] = child
    }

    /// Removes the pointer target. Cleans up empty parent dicts as it unwinds.
    /// Returns true if something was removed.
    @discardableResult
    static func removePointer(_ segments: [String], in dict: inout [String: Any]) -> Bool {
        guard let first = segments.first else { return false }
        if segments.count == 1 {
            return dict.removeValue(forKey: first) != nil
        }
        guard var child = dict[first] as? [String: Any] else { return false }
        let removed = removePointer(Array(segments.dropFirst()), in: &child)
        if child.isEmpty {
            dict.removeValue(forKey: first)
        } else {
            dict[first] = child
        }
        return removed
    }

    static func flatten(_ dict: [String: Any], prefix: String) -> [String] {
        var out: [String] = []
        for (k, v) in dict {
            let joined = prefix.isEmpty ? k : "\(prefix).\(k)"
            if let child = v as? [String: Any] {
                out.append(contentsOf: flatten(child, prefix: joined))
            } else {
                out.append(joined)
            }
        }
        return out
    }

    // MARK: - Store I/O

    private static func resolveWriteTarget(key: String, requested: SecretsStoreKind) throws -> SecretsStoreKind {
        switch requested {
        case .openclaw, .standalone:
            return requested
        case .auto:
            // Follow the existing home if the key already lives somewhere.
            for target in [SecretsStoreKind.openclaw, .standalone] {
                if (try? read(key, from: target)) != nil { return target }
            }
            // Prefer openclaw if the shared store already exists, even if the key is new.
            if FileManager.default.fileExists(atPath: openclawPath.path) {
                return .openclaw
            }
            return .standalone
        }
    }

    private static func loadStore(at url: URL) throws -> [String: Any] {
        guard FileManager.default.fileExists(atPath: url.path) else { return [:] }
        warnIfPermsTooWide(url)
        do {
            let data = try Data(contentsOf: url)
            if data.isEmpty { return [:] }
            let parsed = try JSONSerialization.jsonObject(with: data, options: [])
            guard let dict = parsed as? [String: Any] else {
                throw SecretsError.malformedStore(path: url.path, underlying: NSError(
                    domain: "SecretsStore", code: 1,
                    userInfo: [NSLocalizedDescriptionKey: "root must be a JSON object"]
                ))
            }
            return dict
        } catch let e as SecretsError {
            throw e
        } catch {
            throw SecretsError.malformedStore(path: url.path, underlying: error)
        }
    }

    private static func atomicWriteJSON(_ dict: [String: Any], to url: URL) throws {
        let data: Data
        do {
            data = try JSONSerialization.data(
                withJSONObject: dict,
                options: [.prettyPrinted, .sortedKeys]
            )
        } catch {
            throw SecretsError.writeFailed(path: url.path, underlying: error)
        }
        let dir = url.deletingLastPathComponent()
        let tmp = dir.appendingPathComponent(".\(url.lastPathComponent).\(UUID().uuidString).tmp")
        do {
            try data.write(to: tmp, options: [.atomic])
            try FileManager.default.setAttributes([.posixPermissions: NSNumber(value: 0o600)], ofItemAtPath: tmp.path)
            // Append final newline for POSIX-friendliness.
            if let newline = "\n".data(using: .utf8) {
                let handle = try FileHandle(forWritingTo: tmp)
                try handle.seekToEnd()
                try handle.write(contentsOf: newline)
                try handle.close()
            }
            _ = try FileManager.default.replaceItemAt(url, withItemAt: tmp)
            // replaceItemAt can reset perms on some filesystems; re-apply to the final URL.
            try FileManager.default.setAttributes([.posixPermissions: NSNumber(value: 0o600)], ofItemAtPath: url.path)
        } catch {
            try? FileManager.default.removeItem(at: tmp)
            throw SecretsError.writeFailed(path: url.path, underlying: error)
        }
    }

    private static func warnIfPermsTooWide(_ url: URL) {
        guard let attrs = try? FileManager.default.attributesOfItem(atPath: url.path),
              let perms = attrs[.posixPermissions] as? NSNumber else { return }
        let mode = perms.uint16Value & 0o777
        if mode & 0o077 != 0 {
            let octal = String(mode, radix: 8)
            FileHandle.standardError.write(Data(
                "[apple-pim] Warning: secrets file \(url.path) has mode 0\(octal) (world/group-accessible). Fix with: chmod 600 \(url.path)\n".utf8
            ))
        }
    }

    private static func dropSpotlightMarker(in dir: URL) {
        let marker = dir.appendingPathComponent(".metadata_never_index")
        if !FileManager.default.fileExists(atPath: marker.path) {
            FileManager.default.createFile(atPath: marker.path, contents: Data(), attributes: nil)
        }
    }
}
