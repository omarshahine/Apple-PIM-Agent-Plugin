import Contacts
import Testing
@testable import ContactsCLI
@testable import PIMConfig

@Suite("Container Filtering")
struct ContainerFilterTests {

    // MARK: - allAccountContainers

    @Test("allAccountContainers excludes entries that are also groups")
    func testAllAccountContainersExcludesGroups() throws {
        let containers = try allAccountContainers()
        let groupIds = Set(try contactStore.groups(matching: nil).map { $0.identifier })
        for container in containers {
            #expect(!groupIds.contains(container.identifier),
                    "Container \(container.name) is also a group — should be excluded")
        }
    }

    @Test("allAccountContainers returns at least one container")
    func testAllAccountContainersNotEmpty() throws {
        let containers = try allAccountContainers()
        #expect(!containers.isEmpty)
    }

    // MARK: - filteredContainers

    @Test("filteredContainers with mode all returns all accounts")
    func testFilteredContainersAllMode() throws {
        let config = PIMConfiguration(contacts: DomainFilterConfig(mode: .all))
        let all = try allAccountContainers()
        let filtered = try filteredContainers(config: config)
        #expect(filtered.count == all.count)
    }

    @Test("filteredContainers with allowlist returns only matching")
    func testFilteredContainersAllowlist() throws {
        let all = try allAccountContainers()
        guard let first = all.first else { return }
        let config = PIMConfiguration(contacts: DomainFilterConfig(mode: .allowlist, items: [first.name]))
        let filtered = try filteredContainers(config: config)
        #expect(filtered.count == 1)
        #expect(filtered[0].name == first.name)
    }

    @Test("filteredContainers with empty allowlist returns none")
    func testFilteredContainersEmptyAllowlist() throws {
        let config = PIMConfiguration(contacts: DomainFilterConfig(mode: .allowlist, items: []))
        let filtered = try filteredContainers(config: config)
        #expect(filtered.isEmpty)
    }

    @Test("filteredContainers with blocklist excludes matching")
    func testFilteredContainersBlocklist() throws {
        let all = try allAccountContainers()
        guard let first = all.first else { return }
        let config = PIMConfiguration(contacts: DomainFilterConfig(mode: .blocklist, items: [first.name]))
        let filtered = try filteredContainers(config: config)
        #expect(filtered.count == all.count - 1)
        #expect(!filtered.contains(where: { $0.name == first.name }))
    }

    @Test("filteredContainers allowlist is case-insensitive")
    func testFilteredContainersCaseInsensitive() throws {
        let all = try allAccountContainers()
        guard let first = all.first else { return }
        let config = PIMConfiguration(contacts: DomainFilterConfig(mode: .allowlist, items: [first.name.uppercased()]))
        let filtered = try filteredContainers(config: config)
        #expect(filtered.count == 1)
    }

    // MARK: - resolveAccountContainer

    @Test("resolveAccountContainer returns container for backing contact")
    func testResolveAccountContainerBacking() throws {
        let all = try allAccountContainers()
        let pred = CNContact.predicateForContactsInContainer(withIdentifier: all[0].identifier)
        let req = CNContactFetchRequest(keysToFetch: [CNContactIdentifierKey as CNKeyDescriptor])
        req.predicate = pred
        req.unifyResults = false
        var backingId: String?
        try contactStore.enumerateContacts(with: req) { c, stop in
            backingId = c.identifier
            stop.pointee = true
        }
        guard let bid = backingId else { return }
        let resolved = try resolveAccountContainer(forContactId: bid)
        #expect(resolved != nil, "Backing contact should resolve to a container")
    }

    @Test("isMultiSourceUnifiedId returns false for backing ID")
    func testIsMultiSourceFalseForBacking() throws {
        let all = try allAccountContainers()
        let pred = CNContact.predicateForContactsInContainer(withIdentifier: all[0].identifier)
        let req = CNContactFetchRequest(keysToFetch: [CNContactIdentifierKey as CNKeyDescriptor])
        req.predicate = pred
        req.unifyResults = false
        var backingId: String?
        try contactStore.enumerateContacts(with: req) { c, stop in
            backingId = c.identifier
            stop.pointee = true
        }
        guard let bid = backingId else { return }
        #expect(try !isMultiSourceUnifiedId(bid))
    }

    // MARK: - resolveAccountContainer with unified ID (R3)

    @Test("resolveAccountContainer returns nil for multi-source unified ID")
    func testResolveAccountContainerUnified() throws {
        // Dynamically find a multi-source unified contact (linked across containers)
        guard let unifiedId = try findMultiSourceUnifiedId() else { return }
        let resolved = try resolveAccountContainer(forContactId: unifiedId)
        #expect(resolved == nil, "Multi-source unified ID should resolve to nil")
    }

    // MARK: - isMultiSourceUnifiedId (R4, R6)

    @Test("isMultiSourceUnifiedId returns true for multi-source unified ID")
    func testIsMultiSourceTrue() throws {
        guard let unifiedId = try findMultiSourceUnifiedId() else { return }
        #expect(try isMultiSourceUnifiedId(unifiedId))
    }

    @Test("isMultiSourceUnifiedId returns false for single-source contact")
    func testIsMultiSourceFalseSingleSource() throws {
        let all = try allAccountContainers()
        guard let first = all.first else { return }
        let pred = CNContact.predicateForContactsInContainer(withIdentifier: first.identifier)
        let req = CNContactFetchRequest(keysToFetch: [CNContactIdentifierKey as CNKeyDescriptor])
        req.predicate = pred
        req.unifyResults = false
        var backingId: String?
        try contactStore.enumerateContacts(with: req) { c, stop in
            backingId = c.identifier
            stop.pointee = true
        }
        guard let bid = backingId else { return }
        #expect(try !isMultiSourceUnifiedId(bid))
    }

    // MARK: - resolveAuthorizedBackings (R7, R8, R9)

    @Test("resolveAuthorizedBackings with partial allowlist filters correctly")
    func testAuthorizedBackingsPartial() throws {
        guard let unifiedId = try findMultiSourceUnifiedId() else { return }
        let all = try allAccountContainers()
        let allIds = Set(all.map { $0.identifier })
        let keys = [CNContactIdentifierKey as CNKeyDescriptor]
        let allBackings = try resolveAuthorizedBackings(
            forContactId: unifiedId,
            allowedContainerIds: allIds,
            keysToFetch: keys
        )
        guard allBackings.count >= 2 else { return }
        // Allow only ONE of the containers the contact actually has a backing in
        let oneContainerId = allBackings[0].accountContainer.identifier
        let partialBackings = try resolveAuthorizedBackings(
            forContactId: unifiedId,
            allowedContainerIds: Set([oneContainerId]),
            keysToFetch: keys
        )
        #expect(partialBackings.count >= 1, "At least one backing should match")
        #expect(partialBackings.count < allBackings.count,
                "Partial allowlist should return fewer backings than full")
    }

    @Test("resolveAuthorizedBackings with all containers returns all backings")
    func testAuthorizedBackingsFull() throws {
        guard let unifiedId = try findMultiSourceUnifiedId() else { return }
        let all = try allAccountContainers()
        let allowed = Set(all.map { $0.identifier })
        let keys = [CNContactIdentifierKey as CNKeyDescriptor]
        let results = try resolveAuthorizedBackings(
            forContactId: unifiedId,
            allowedContainerIds: allowed,
            keysToFetch: keys
        )
        #expect(results.count >= 2, "Multi-source contact should have at least 2 backings")
    }

    @Test("resolveAuthorizedBackings with no matching containers returns empty")
    func testAuthorizedBackingsNone() throws {
        guard let unifiedId = try findMultiSourceUnifiedId() else { return }
        let allowed = Set(["nonexistent-container-id"])
        let keys = [CNContactIdentifierKey as CNKeyDescriptor]
        let results = try resolveAuthorizedBackings(
            forContactId: unifiedId,
            allowedContainerIds: allowed,
            keysToFetch: keys
        )
        #expect(results.isEmpty, "No backings should be authorized")
    }

    /// Find any multi-source unified contact ID on this system (linked across 2+ containers).
    /// Returns nil if none exist — tests that need one will early-return.
    private static var cachedMultiSourceId: String?
    private static var didSearch = false

    private func findMultiSourceUnifiedId() throws -> String? {
        if Self.didSearch { return Self.cachedMultiSourceId }
        Self.didSearch = true
        let req = CNContactFetchRequest(keysToFetch: [CNContactIdentifierKey as CNKeyDescriptor])
        req.unifyResults = true
        var checked = 0
        try contactStore.enumerateContacts(with: req) { contact, stop in
            checked += 1
            if (try? isMultiSourceUnifiedId(contact.identifier)) == true {
                Self.cachedMultiSourceId = contact.identifier
                stop.pointee = true
            }
            if checked >= 500 { stop.pointee = true }
        }
        return Self.cachedMultiSourceId
    }

    // MARK: - fetchContactsFromAllowedContainers

    @Test("fetchContactsFromAllowedContainers returns only contacts from allowed containers")
    func testFetchFromAllowedOnly() throws {
        let all = try allAccountContainers()
        guard let first = all.first else { return }
        let config = PIMConfiguration(contacts: DomainFilterConfig(mode: .allowlist, items: [first.name]))
        let contacts = try fetchContactsFromAllowedContainers(config: config)
        let directPredicate = CNContact.predicateForContactsInContainer(withIdentifier: first.identifier)
        let direct = try contactStore.unifiedContacts(matching: directPredicate, keysToFetch: keysToFetch)
        #expect(contacts.count == direct.count)
    }

    @Test("fetchContactsFromAllowedContainers with empty allowlist returns zero")
    func testFetchFromEmptyAllowlist() throws {
        let config = PIMConfiguration(contacts: DomainFilterConfig(mode: .allowlist, items: []))
        let contacts = try fetchContactsFromAllowedContainers(config: config)
        #expect(contacts.isEmpty)
    }
}
