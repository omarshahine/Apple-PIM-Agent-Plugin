import ArgumentParser
import Contacts
import Foundation

@main
struct ContactsCLI: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "contacts-cli",
        abstract: "Manage macOS Contacts",
        subcommands: [
            ListGroups.self,
            ListContacts.self,
            SearchContacts.self,
            GetContact.self,
            CreateContact.self,
            UpdateContact.self,
            DeleteContact.self,
        ]
    )
}

// MARK: - Shared Utilities

let contactStore = CNContactStore()

func requestContactsAccess() async throws {
    let status = CNContactStore.authorizationStatus(for: .contacts)

    switch status {
    case .authorized:
        return
    case .notDetermined:
        let granted = try await contactStore.requestAccess(for: .contacts)
        guard granted else {
            throw CLIError.accessDenied("Contacts access denied. Grant access in System Settings > Privacy & Security > Contacts")
        }
    case .denied, .restricted:
        throw CLIError.accessDenied("Contacts access denied. Grant access in System Settings > Privacy & Security > Contacts")
    @unknown default:
        throw CLIError.accessDenied("Unknown contacts authorization status")
    }
}

enum CLIError: Error, LocalizedError {
    case accessDenied(String)
    case notFound(String)
    case invalidInput(String)

    var errorDescription: String? {
        switch self {
        case .accessDenied(let msg): return msg
        case .notFound(let msg): return msg
        case .invalidInput(let msg): return msg
        }
    }
}

func outputJSON(_ value: Any) {
    if let data = try? JSONSerialization.data(withJSONObject: value, options: [.prettyPrinted, .sortedKeys]),
       let string = String(data: data, encoding: .utf8) {
        print(string)
    }
}

let keysToFetch: [CNKeyDescriptor] = [
    CNContactIdentifierKey as CNKeyDescriptor,
    CNContactGivenNameKey as CNKeyDescriptor,
    CNContactFamilyNameKey as CNKeyDescriptor,
    CNContactMiddleNameKey as CNKeyDescriptor,
    CNContactNamePrefixKey as CNKeyDescriptor,
    CNContactNameSuffixKey as CNKeyDescriptor,
    CNContactNicknameKey as CNKeyDescriptor,
    CNContactOrganizationNameKey as CNKeyDescriptor,
    CNContactJobTitleKey as CNKeyDescriptor,
    CNContactDepartmentNameKey as CNKeyDescriptor,
    CNContactEmailAddressesKey as CNKeyDescriptor,
    CNContactPhoneNumbersKey as CNKeyDescriptor,
    CNContactPostalAddressesKey as CNKeyDescriptor,
    CNContactUrlAddressesKey as CNKeyDescriptor,
    CNContactBirthdayKey as CNKeyDescriptor,
    CNContactNoteKey as CNKeyDescriptor,
    CNContactImageDataAvailableKey as CNKeyDescriptor,
    CNContactThumbnailImageDataKey as CNKeyDescriptor,
    CNContactImageDataKey as CNKeyDescriptor,
    CNContactTypeKey as CNKeyDescriptor,
    CNContactRelationsKey as CNKeyDescriptor,
    CNContactSocialProfilesKey as CNKeyDescriptor,
    CNContactInstantMessageAddressesKey as CNKeyDescriptor,
    CNContactFormatter.descriptorForRequiredKeys(for: .fullName),
]

func groupToDict(_ group: CNGroup) -> [String: Any] {
    return [
        "id": group.identifier,
        "name": group.name
    ]
}

func contactToDict(_ contact: CNContact, brief: Bool = false) -> [String: Any] {
    var dict: [String: Any] = [
        "id": contact.identifier,
        "givenName": contact.givenName,
        "familyName": contact.familyName,
        "fullName": CNContactFormatter.string(from: contact, style: .fullName) ?? "\(contact.givenName) \(contact.familyName)".trimmingCharacters(in: .whitespaces)
    ]

    if brief {
        // Just include primary email and phone for brief listing
        if let primaryEmail = contact.emailAddresses.first {
            dict["email"] = primaryEmail.value as String
        }
        if let primaryPhone = contact.phoneNumbers.first {
            dict["phone"] = primaryPhone.value.stringValue
        }
        if !contact.organizationName.isEmpty {
            dict["organization"] = contact.organizationName
        }
        return dict
    }

    // Full details
    if !contact.middleName.isEmpty { dict["middleName"] = contact.middleName }
    if !contact.namePrefix.isEmpty { dict["namePrefix"] = contact.namePrefix }
    if !contact.nameSuffix.isEmpty { dict["nameSuffix"] = contact.nameSuffix }
    if !contact.nickname.isEmpty { dict["nickname"] = contact.nickname }
    if !contact.organizationName.isEmpty { dict["organization"] = contact.organizationName }
    if !contact.jobTitle.isEmpty { dict["jobTitle"] = contact.jobTitle }
    if !contact.departmentName.isEmpty { dict["department"] = contact.departmentName }

    if !contact.emailAddresses.isEmpty {
        dict["emails"] = contact.emailAddresses.map { labeled in
            [
                "label": CNLabeledValue<NSString>.localizedString(forLabel: labeled.label ?? ""),
                "value": labeled.value as String
            ]
        }
    }

    if !contact.phoneNumbers.isEmpty {
        dict["phones"] = contact.phoneNumbers.map { labeled in
            [
                "label": CNLabeledValue<CNPhoneNumber>.localizedString(forLabel: labeled.label ?? ""),
                "value": labeled.value.stringValue
            ]
        }
    }

    if !contact.postalAddresses.isEmpty {
        dict["addresses"] = contact.postalAddresses.map { labeled in
            let addr = labeled.value
            return [
                "label": CNLabeledValue<CNPostalAddress>.localizedString(forLabel: labeled.label ?? ""),
                "street": addr.street,
                "city": addr.city,
                "state": addr.state,
                "postalCode": addr.postalCode,
                "country": addr.country
            ]
        }
    }

    if !contact.urlAddresses.isEmpty {
        dict["urls"] = contact.urlAddresses.map { labeled in
            [
                "label": CNLabeledValue<NSString>.localizedString(forLabel: labeled.label ?? ""),
                "value": labeled.value as String
            ]
        }
    }

    if let birthday = contact.birthday {
        var birthdayDict: [String: Any] = [:]
        if let year = birthday.year { birthdayDict["year"] = year }
        if let month = birthday.month { birthdayDict["month"] = month }
        if let day = birthday.day { birthdayDict["day"] = day }
        dict["birthday"] = birthdayDict
    }

    // Notes may not be available due to macOS privacy restrictions
    if contact.isKeyAvailable(CNContactNoteKey), !contact.note.isEmpty {
        dict["notes"] = contact.note
    }

    // Check if image keys are available before accessing
    let hasImageKey = contact.isKeyAvailable(CNContactImageDataAvailableKey)
    dict["hasImage"] = hasImageKey ? contact.imageDataAvailable : false
    dict["contactType"] = contact.contactType == .person ? "person" : "organization"

    // Include image data as base64 if available (prefer thumbnail for smaller payload)
    if hasImageKey && contact.imageDataAvailable {
        if contact.isKeyAvailable(CNContactThumbnailImageDataKey),
           let thumbnailData = contact.thumbnailImageData {
            dict["imageBase64"] = thumbnailData.base64EncodedString()
            dict["imageType"] = "thumbnail"
        } else if contact.isKeyAvailable(CNContactImageDataKey),
                  let imageData = contact.imageData {
            dict["imageBase64"] = imageData.base64EncodedString()
            dict["imageType"] = "full"
        }
    }

    if !contact.contactRelations.isEmpty {
        dict["relations"] = contact.contactRelations.map { labeled in
            [
                "label": CNLabeledValue<CNContactRelation>.localizedString(forLabel: labeled.label ?? ""),
                "name": labeled.value.name
            ]
        }
    }

    if !contact.socialProfiles.isEmpty {
        dict["socialProfiles"] = contact.socialProfiles.map { labeled in
            [
                "service": labeled.value.service,
                "username": labeled.value.username,
                "url": labeled.value.urlString
            ]
        }
    }

    return dict
}

// MARK: - Commands

struct ListGroups: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "groups",
        abstract: "List all contact groups"
    )

    func run() async throws {
        try await requestContactsAccess()

        let groups = try contactStore.groups(matching: nil)
        let result = groups.map { groupToDict($0) }

        outputJSON([
            "success": true,
            "groups": result
        ])
    }
}

struct ListContacts: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "list",
        abstract: "List contacts"
    )

    @Option(name: .long, help: "Group name or ID to filter by")
    var group: String?

    @Option(name: .long, help: "Maximum number of contacts")
    var limit: Int = 100

    func run() async throws {
        try await requestContactsAccess()

        var contacts: [CNContact] = []

        if let groupFilter = group {
            // Find the group
            let groups = try contactStore.groups(matching: nil)
            guard let matchedGroup = groups.first(where: { $0.identifier == groupFilter || $0.name.lowercased() == groupFilter.lowercased() }) else {
                throw CLIError.notFound("Group not found: \(groupFilter)")
            }

            // Fetch contacts in group
            let predicate = CNContact.predicateForContactsInGroup(withIdentifier: matchedGroup.identifier)
            contacts = try contactStore.unifiedContacts(matching: predicate, keysToFetch: keysToFetch)
        } else {
            // Fetch all contacts
            let request = CNContactFetchRequest(keysToFetch: keysToFetch)
            request.sortOrder = .familyName

            try contactStore.enumerateContacts(with: request) { contact, stop in
                contacts.append(contact)
                if contacts.count >= limit {
                    stop.pointee = true
                }
            }
        }

        let result = contacts.prefix(limit).map { contactToDict($0, brief: true) }

        outputJSON([
            "success": true,
            "contacts": Array(result),
            "count": result.count
        ])
    }
}

struct SearchContacts: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "search",
        abstract: "Search contacts by name, email, or phone"
    )

    @Argument(help: "Search query")
    var query: String

    @Option(name: .long, help: "Maximum results")
    var limit: Int = 50

    func run() async throws {
        try await requestContactsAccess()

        let predicate = CNContact.predicateForContacts(matchingName: query)
        var contacts = try contactStore.unifiedContacts(matching: predicate, keysToFetch: keysToFetch)

        // Also search by email and phone if name search returns few results
        if contacts.count < limit {
            let allContacts = try fetchAllContacts()
            let queryLower = query.lowercased()

            let emailPhoneMatches = allContacts.filter { contact in
                // Skip if already found by name
                if contacts.contains(where: { $0.identifier == contact.identifier }) {
                    return false
                }

                // Check emails
                for email in contact.emailAddresses {
                    if (email.value as String).lowercased().contains(queryLower) {
                        return true
                    }
                }

                // Check phones (strip non-digits for comparison)
                let queryDigits = query.filter { $0.isNumber }
                for phone in contact.phoneNumbers {
                    let phoneDigits = phone.value.stringValue.filter { $0.isNumber }
                    if phoneDigits.contains(queryDigits) || queryDigits.contains(phoneDigits) {
                        return true
                    }
                }

                return false
            }

            contacts.append(contentsOf: emailPhoneMatches)
        }

        let result = contacts.prefix(limit).map { contactToDict($0, brief: true) }

        outputJSON([
            "success": true,
            "query": query,
            "contacts": Array(result),
            "count": result.count
        ])
    }

    func fetchAllContacts() throws -> [CNContact] {
        var contacts: [CNContact] = []
        let request = CNContactFetchRequest(keysToFetch: keysToFetch)

        try contactStore.enumerateContacts(with: request) { contact, _ in
            contacts.append(contact)
        }

        return contacts
    }
}

struct GetContact: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "get",
        abstract: "Get full details for a contact"
    )

    @Option(name: .long, help: "Contact ID")
    var id: String

    func run() async throws {
        try await requestContactsAccess()

        let predicate = CNContact.predicateForContacts(withIdentifiers: [id])
        let contacts = try contactStore.unifiedContacts(matching: predicate, keysToFetch: keysToFetch)

        guard let contact = contacts.first else {
            throw CLIError.notFound("Contact not found: \(id)")
        }

        outputJSON([
            "success": true,
            "contact": contactToDict(contact, brief: false)
        ])
    }
}

struct CreateContact: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "create",
        abstract: "Create a new contact"
    )

    @Option(name: .long, help: "First name")
    var firstName: String?

    @Option(name: .long, help: "Last name")
    var lastName: String?

    @Option(name: .long, help: "Full name (alternative to first/last)")
    var name: String?

    @Option(name: .long, help: "Email address")
    var email: String?

    @Option(name: .long, help: "Phone number")
    var phone: String?

    @Option(name: .long, help: "Organization/company name")
    var organization: String?

    @Option(name: .long, help: "Job title")
    var jobTitle: String?

    @Option(name: .long, help: "Notes")
    var notes: String?

    func run() async throws {
        try await requestContactsAccess()

        let contact = CNMutableContact()

        if let fullName = name {
            // Parse full name into parts
            let parts = fullName.split(separator: " ")
            if parts.count == 1 {
                contact.givenName = String(parts[0])
            } else if parts.count >= 2 {
                contact.givenName = String(parts[0])
                contact.familyName = parts.dropFirst().joined(separator: " ")
            }
        } else {
            if let first = firstName { contact.givenName = first }
            if let last = lastName { contact.familyName = last }
        }

        if let emailAddr = email {
            contact.emailAddresses = [CNLabeledValue(label: CNLabelWork, value: emailAddr as NSString)]
        }

        if let phoneNum = phone {
            contact.phoneNumbers = [CNLabeledValue(label: CNLabelPhoneNumberMain, value: CNPhoneNumber(stringValue: phoneNum))]
        }

        if let org = organization {
            contact.organizationName = org
        }

        if let title = jobTitle {
            contact.jobTitle = title
        }

        if let note = notes {
            contact.note = note
        }

        let saveRequest = CNSaveRequest()
        saveRequest.add(contact, toContainerWithIdentifier: nil)
        try contactStore.execute(saveRequest)

        outputJSON([
            "success": true,
            "message": "Contact created successfully",
            "contact": contactToDict(contact, brief: false)
        ])
    }
}

struct UpdateContact: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "update",
        abstract: "Update an existing contact"
    )

    @Option(name: .long, help: "Contact ID to update")
    var id: String

    @Option(name: .long, help: "New first name")
    var firstName: String?

    @Option(name: .long, help: "New last name")
    var lastName: String?

    @Option(name: .long, help: "New email (replaces primary)")
    var email: String?

    @Option(name: .long, help: "New phone (replaces primary)")
    var phone: String?

    @Option(name: .long, help: "New organization")
    var organization: String?

    @Option(name: .long, help: "New job title")
    var jobTitle: String?

    @Option(name: .long, help: "New notes")
    var notes: String?

    func run() async throws {
        try await requestContactsAccess()

        let predicate = CNContact.predicateForContacts(withIdentifiers: [id])
        let contacts = try contactStore.unifiedContacts(matching: predicate, keysToFetch: keysToFetch)

        guard let existingContact = contacts.first else {
            throw CLIError.notFound("Contact not found: \(id)")
        }

        let contact = existingContact.mutableCopy() as! CNMutableContact

        if let first = firstName { contact.givenName = first }
        if let last = lastName { contact.familyName = last }
        if let org = organization { contact.organizationName = org }
        if let title = jobTitle { contact.jobTitle = title }
        if let note = notes { contact.note = note }

        if let emailAddr = email {
            // Replace primary email or add new
            if contact.emailAddresses.isEmpty {
                contact.emailAddresses = [CNLabeledValue(label: CNLabelWork, value: emailAddr as NSString)]
            } else {
                var emails = contact.emailAddresses.map { $0.mutableCopy() as! CNLabeledValue<NSString> }
                emails[0] = CNLabeledValue(label: emails[0].label, value: emailAddr as NSString)
                contact.emailAddresses = emails
            }
        }

        if let phoneNum = phone {
            if contact.phoneNumbers.isEmpty {
                contact.phoneNumbers = [CNLabeledValue(label: CNLabelPhoneNumberMain, value: CNPhoneNumber(stringValue: phoneNum))]
            } else {
                var phones = contact.phoneNumbers.map { $0.mutableCopy() as! CNLabeledValue<CNPhoneNumber> }
                phones[0] = CNLabeledValue(label: phones[0].label, value: CNPhoneNumber(stringValue: phoneNum))
                contact.phoneNumbers = phones
            }
        }

        let saveRequest = CNSaveRequest()
        saveRequest.update(contact)
        try contactStore.execute(saveRequest)

        outputJSON([
            "success": true,
            "message": "Contact updated successfully",
            "contact": contactToDict(contact, brief: false)
        ])
    }
}

struct DeleteContact: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "delete",
        abstract: "Delete a contact"
    )

    @Option(name: .long, help: "Contact ID to delete")
    var id: String

    func run() async throws {
        try await requestContactsAccess()

        let predicate = CNContact.predicateForContacts(withIdentifiers: [id])
        let contacts = try contactStore.unifiedContacts(matching: predicate, keysToFetch: keysToFetch)

        guard let existingContact = contacts.first else {
            throw CLIError.notFound("Contact not found: \(id)")
        }

        let contactInfo = contactToDict(existingContact, brief: true)
        let contact = existingContact.mutableCopy() as! CNMutableContact

        let saveRequest = CNSaveRequest()
        saveRequest.delete(contact)
        try contactStore.execute(saveRequest)

        outputJSON([
            "success": true,
            "message": "Contact deleted successfully",
            "deletedContact": contactInfo
        ])
    }
}
