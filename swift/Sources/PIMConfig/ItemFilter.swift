import Foundation

/// Filters items (calendars, reminder lists, contact groups) against a `DomainFilterConfig`.
///
/// Supports three match strategies:
/// - Exact name match (case-insensitive)
/// - Calendar/list ID match (case-insensitive)
/// - Emoji-stripped fuzzy match (e.g., "Travel" matches "✈️ Travel")
public struct ItemFilter {

    /// Check if a single item is allowed under the given filter config.
    ///
    /// - Parameters:
    ///   - name: The item's display name (e.g., calendar title).
    ///   - id: The item's stable identifier (e.g., `calendarIdentifier`). Optional.
    ///   - config: The domain filter configuration to check against.
    /// - Returns: `true` if the item is accessible.
    public static func isAllowed(
        name: String,
        id: String? = nil,
        config: DomainFilterConfig
    ) -> Bool {
        switch config.mode {
        case .all:
            return true
        case .allowlist:
            return matchesAny(name: name, id: id, items: config.items)
        case .blocklist:
            return !matchesAny(name: name, id: id, items: config.items)
        }
    }

    /// Filter an array of items, keeping only those allowed by the config.
    ///
    /// - Parameters:
    ///   - items: The array to filter.
    ///   - config: The domain filter configuration.
    ///   - name: Closure to extract the item's display name.
    ///   - id: Closure to extract the item's identifier (optional).
    /// - Returns: Filtered array containing only allowed items.
    public static func filter<T>(
        items: [T],
        config: DomainFilterConfig,
        name: (T) -> String,
        id: ((T) -> String?)? = nil
    ) -> [T] {
        guard config.mode != .all else { return items }
        return items.filter { item in
            isAllowed(name: name(item), id: id?(item), config: config)
        }
    }

    // MARK: - Matching

    static func matchesAny(name: String, id: String?, items: [String]) -> Bool {
        let nameLower = name.lowercased()
        let normalizedName = stripEmojiPrefix(name)

        return items.contains { item in
            let itemLower = item.lowercased()
            let normalizedItem = stripEmojiPrefix(item)

            // Exact name match (case-insensitive)
            if itemLower == nameLower { return true }

            // ID match (case-insensitive)
            if let id, itemLower == id.lowercased() { return true }

            // Emoji-stripped fuzzy match
            if !normalizedItem.isEmpty && normalizedItem == normalizedName { return true }

            return false
        }
    }

    // MARK: - Emoji Stripping

    /// Strip leading emoji characters and whitespace for fuzzy matching.
    /// Handles names like "✈️ Travel" or "🏦 Budget & Finances".
    ///
    /// Uses Unicode scalar properties to detect emoji, variation selectors,
    /// and zero-width joiners, then returns the remaining text lowercased.
    static func stripEmojiPrefix(_ str: String) -> String {
        var scalars = str.unicodeScalars[...]

        while let first = scalars.first {
            if first.properties.isEmoji && first.value > 0x23 // Skip ASCII digits/symbols that isEmoji matches
                || first.properties.isEmojiPresentation
                || first == "\u{FE0F}"  // Variation selector-16
                || first == "\u{FE0E}"  // Variation selector-15
                || first == "\u{200D}"  // Zero-width joiner
                || first == " "
            {
                scalars = scalars.dropFirst()
            } else {
                break
            }
        }

        return String(scalars).lowercased()
    }
}
