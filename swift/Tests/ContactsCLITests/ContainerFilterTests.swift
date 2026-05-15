import Testing
@testable import ContactsCLI
@testable import PIMConfig

@Suite("Container Filtering")
struct ContainerFilterTests {

    @Test("contactAccessMode returns fullAccess for mode all")
    func testAccessModeAllReturnsFullAccess() {
        let config = PIMConfiguration(contacts: DomainFilterConfig(mode: .all))
        let mode = contactAccessMode(config: config)
        guard case .fullAccess = mode else {
            Issue.record("Expected .fullAccess, got \(mode)")
            return
        }
    }

    @Test("contactAccessMode returns fullAccess for mode all even with items")
    func testAccessModeAllIgnoresItems() {
        let config = PIMConfiguration(contacts: DomainFilterConfig(mode: .all, items: ["Work", "Personal"]))
        let mode = contactAccessMode(config: config)
        guard case .fullAccess = mode else {
            Issue.record("Expected .fullAccess, got \(mode)")
            return
        }
    }

    @Test("ContactAccessMode enum cases are distinct")
    func testAccessModeEnumDistinct() {
        let full = ContactAccessMode.fullAccess
        let scoped = ContactAccessMode.scopedContainers(Set(["container-1", "container-2"]))

        switch full {
        case .fullAccess: break
        case .scopedContainers: Issue.record("fullAccess matched scopedContainers")
        }

        switch scoped {
        case .scopedContainers(let ids):
            #expect(ids.count == 2)
            #expect(ids.contains("container-1"))
            #expect(ids.contains("container-2"))
        case .fullAccess:
            Issue.record("scopedContainers matched fullAccess")
        }
    }
}
