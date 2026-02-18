import Testing
@testable import PIMConfig

@Suite("ItemFilter")
struct ItemFilterTests {

    // MARK: - Mode: all

    @Test("All mode allows everything")
    func testAllModeAllowsEverything() {
        let config = DomainFilterConfig(mode: .all, items: ["Work"])
        #expect(ItemFilter.isAllowed(name: "Personal", config: config))
        #expect(ItemFilter.isAllowed(name: "Work", config: config))
        #expect(ItemFilter.isAllowed(name: "Random", config: config))
    }

    // MARK: - Mode: allowlist

    @Test("Allowlist matches exact name (case-insensitive)")
    func testAllowlistExactName() {
        let config = DomainFilterConfig(mode: .allowlist, items: ["Personal", "Family"])
        #expect(ItemFilter.isAllowed(name: "Personal", config: config))
        #expect(ItemFilter.isAllowed(name: "personal", config: config))
        #expect(ItemFilter.isAllowed(name: "FAMILY", config: config))
        #expect(!ItemFilter.isAllowed(name: "Work", config: config))
    }

    @Test("Allowlist matches by ID")
    func testAllowlistMatchesById() {
        let config = DomainFilterConfig(mode: .allowlist, items: ["ABC-123"])
        #expect(ItemFilter.isAllowed(name: "Some Calendar", id: "ABC-123", config: config))
        #expect(ItemFilter.isAllowed(name: "Some Calendar", id: "abc-123", config: config))
        #expect(!ItemFilter.isAllowed(name: "Other", id: "XYZ-999", config: config))
    }

    @Test("Allowlist matches emoji-stripped name")
    func testAllowlistEmojiStripped() {
        let config = DomainFilterConfig(mode: .allowlist, items: ["Travel", "Budget & Finances"])
        #expect(ItemFilter.isAllowed(name: "✈️ Travel", config: config))
        #expect(ItemFilter.isAllowed(name: "🏦 Budget & Finances", config: config))
    }

    @Test("Allowlist with emoji items matches plain names")
    func testAllowlistEmojiItemsMatchPlain() {
        let config = DomainFilterConfig(mode: .allowlist, items: ["✈️ Travel"])
        #expect(ItemFilter.isAllowed(name: "Travel", config: config))
        #expect(ItemFilter.isAllowed(name: "travel", config: config))
    }

    @Test("Empty allowlist blocks everything")
    func testEmptyAllowlistBlocksAll() {
        let config = DomainFilterConfig(mode: .allowlist, items: [])
        #expect(!ItemFilter.isAllowed(name: "Personal", config: config))
        #expect(!ItemFilter.isAllowed(name: "Work", config: config))
    }

    // MARK: - Mode: blocklist

    @Test("Blocklist excludes matched items")
    func testBlocklistExcludesMatched() {
        let config = DomainFilterConfig(mode: .blocklist, items: ["Holidays", "Birthdays"])
        #expect(!ItemFilter.isAllowed(name: "Holidays", config: config))
        #expect(!ItemFilter.isAllowed(name: "Birthdays", config: config))
        #expect(ItemFilter.isAllowed(name: "Personal", config: config))
    }

    @Test("Blocklist allows non-matched items")
    func testBlocklistAllowsUnmatched() {
        let config = DomainFilterConfig(mode: .blocklist, items: ["Spam"])
        #expect(ItemFilter.isAllowed(name: "Work", config: config))
        #expect(ItemFilter.isAllowed(name: "Personal", config: config))
    }

    @Test("Empty blocklist allows everything")
    func testEmptyBlocklistAllowsAll() {
        let config = DomainFilterConfig(mode: .blocklist, items: [])
        #expect(ItemFilter.isAllowed(name: "Personal", config: config))
        #expect(ItemFilter.isAllowed(name: "Work", config: config))
    }

    // MARK: - Emoji stripping

    @Test("Strip single emoji prefix")
    func testStripSingleEmoji() {
        #expect(ItemFilter.stripEmojiPrefix("✈️ Travel") == "travel")
    }

    @Test("Strip compound emoji prefix")
    func testStripCompoundEmoji() {
        #expect(ItemFilter.stripEmojiPrefix("🏦 Budget & Finances") == "budget & finances")
    }

    @Test("No emoji returns lowercased string")
    func testNoEmojiReturnsLowercased() {
        #expect(ItemFilter.stripEmojiPrefix("Personal") == "personal")
    }

    @Test("Multiple emoji characters stripped")
    func testMultipleEmojiStripped() {
        #expect(ItemFilter.stripEmojiPrefix("🎉🎊 Party") == "party")
    }

    @Test("Empty string returns empty")
    func testEmptyString() {
        #expect(ItemFilter.stripEmojiPrefix("") == "")
    }

    @Test("Only emoji returns empty")
    func testOnlyEmoji() {
        #expect(ItemFilter.stripEmojiPrefix("🏠") == "")
    }

    @Test("Variation selector stripped correctly")
    func testVariationSelector() {
        // U+2708 (airplane) + U+FE0F (variation selector)
        #expect(ItemFilter.stripEmojiPrefix("✈️ Travel") == "travel")
    }

    // MARK: - Filter array

    @Test("Filter array with allowlist")
    func testFilterArray() {
        let config = DomainFilterConfig(mode: .allowlist, items: ["A", "C"])
        let items = ["A", "B", "C", "D"]
        let result = ItemFilter.filter(items: items, config: config, name: { $0 })
        #expect(result == ["A", "C"])
    }

    @Test("Filter array in all mode returns everything")
    func testFilterArrayAllMode() {
        let config = DomainFilterConfig(mode: .all)
        let items = ["A", "B", "C"]
        let result = ItemFilter.filter(items: items, config: config, name: { $0 })
        #expect(result == ["A", "B", "C"])
    }

    @Test("Filter with ID extraction")
    func testFilterWithId() {
        struct Item {
            let name: String
            let id: String
        }
        let config = DomainFilterConfig(mode: .allowlist, items: ["id-2"])
        let items = [Item(name: "First", id: "id-1"), Item(name: "Second", id: "id-2")]
        let result = ItemFilter.filter(
            items: items,
            config: config,
            name: { $0.name },
            id: { $0.id }
        )
        #expect(result.count == 1)
        #expect(result[0].name == "Second")
    }

    // MARK: - Disabled domain

    @Test("Disabled domain config")
    func testDisabledDomain() {
        let config = DomainFilterConfig(enabled: false, mode: .all)
        // isAllowed doesn't check enabled — that's the caller's responsibility
        // This test documents that isAllowed only checks mode/items
        #expect(ItemFilter.isAllowed(name: "Test", config: config))
    }
}
