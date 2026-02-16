import ArgumentParser
import Contacts
import Foundation

@main
struct ContactsCLI: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "contacts-cli",
        abstract: "Manage macOS Contacts",
        subcommands: [
            AuthStatus.self,
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

// MARK: - Auth Status (no prompts)

struct AuthStatus: ParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "auth-status",
        abstract: "Check contacts authorization status without triggering prompts"
    )

    func run() throws {
        let status: String
        switch CNContactStore.authorizationStatus(for: .contacts) {
        case .authorized: status = "authorized"
        case .denied: status = "denied"
        case .restricted: status = "restricted"
        case .notDetermined: status = "notDetermined"
        @unknown default: status = "unknown"
        }
        let result: [String: Any] = ["authorization": status]
        let data = try JSONSerialization.data(withJSONObject: result)
        print(String(data: data, encoding: .utf8)!)
    }
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

/// Parse a birthday string into DateComponents.
/// Accepts "YYYY-MM-DD" (with year) or "MM-DD" (without year).
func parseBirthday(_ string: String) throws -> DateComponents {
    let parts = string.split(separator: "-").compactMap { Int($0) }
    switch parts.count {
    case 3:
        // YYYY-MM-DD
        return DateComponents(year: parts[0], month: parts[1], day: parts[2])
    case 2:
        // MM-DD (no year)
        return DateComponents(month: parts[0], day: parts[1])
    default:
        throw CLIError.invalidInput("Invalid birthday format '\(string)'. Use YYYY-MM-DD or MM-DD.")
    }
}

/// Map a user-friendly label string to a CNLabel constant.
func labelConstant(_ label: String?) -> String {
    guard let label = label?.lowercased() else { return CNLabelOther }
    switch label {
    case "home": return CNLabelHome
    case "work": return CNLabelWork
    case "school": return CNLabelSchool
    case "other": return CNLabelOther
    case "main": return CNLabelPhoneNumberMain
    case "mobile": return CNLabelPhoneNumberMobile
    case "iphone": return CNLabelPhoneNumberiPhone
    case "home fax": return CNLabelPhoneNumberHomeFax
    case "work fax": return CNLabelPhoneNumberWorkFax
    case "pager": return CNLabelPhoneNumberPager
    case "homepage": return CNLabelURLAddressHomePage
    case "icloud": return CNLabelEmailiCloud
    case "anniversary": return CNLabelDateAnniversary
    default: return label
    }
}

/// Map a user-friendly relation label to a CNLabel constant.
func relationLabelConstant(_ label: String?) -> String {
    guard let label = label?.lowercased() else { return CNLabelOther }
    switch label {
    case "assistant": return CNLabelContactRelationAssistant
    case "manager": return CNLabelContactRelationManager
    case "colleague": return CNLabelContactRelationColleague
    case "teacher": return CNLabelContactRelationTeacher
    case "spouse": return CNLabelContactRelationSpouse
    case "partner": return CNLabelContactRelationPartner
    case "parent": return CNLabelContactRelationParent
    case "mother": return CNLabelContactRelationMother
    case "father": return CNLabelContactRelationFather
    case "child": return CNLabelContactRelationChild
    case "daughter": return CNLabelContactRelationDaughter
    case "son": return CNLabelContactRelationSon
    case "sibling": return CNLabelContactRelationSibling
    case "sister": return CNLabelContactRelationSister
    case "brother": return CNLabelContactRelationBrother
    case "friend": return CNLabelContactRelationFriend
    case "wife": return CNLabelContactRelationWife
    case "husband": return CNLabelContactRelationHusband
    default: return labelConstant(label)
    }
}

/// Parse a JSON string into an array of dictionaries.
func parseJSONArray(_ json: String) throws -> [[String: Any]] {
    guard let data = json.data(using: .utf8) else {
        throw CLIError.invalidInput("Invalid JSON array: \(json)")
    }

    let parsedAny: Any
    do {
        parsedAny = try JSONSerialization.jsonObject(with: data)
    } catch {
        throw CLIError.invalidInput("Invalid JSON array: \(json)")
    }

    guard let parsed = parsedAny as? [[String: Any]] else {
        throw CLIError.invalidInput("Invalid JSON array: \(json)")
    }
    return parsed
}

/// Parse JSON addresses into CNLabeledValue<CNPostalAddress> array.
func parseAddresses(_ json: String) throws -> [CNLabeledValue<CNPostalAddress>] {
    let items = try parseJSONArray(json)
    return items.map { item in
        let addr = CNMutablePostalAddress()
        addr.street = item["street"] as? String ?? ""
        addr.city = item["city"] as? String ?? ""
        addr.state = item["state"] as? String ?? ""
        addr.postalCode = item["postalCode"] as? String ?? ""
        addr.country = item["country"] as? String ?? ""
        addr.isoCountryCode = item["isoCountryCode"] as? String ?? ""
        addr.subLocality = item["subLocality"] as? String ?? ""
        addr.subAdministrativeArea = item["subAdministrativeArea"] as? String ?? ""
        return CNLabeledValue(label: labelConstant(item["label"] as? String), value: addr as CNPostalAddress)
    }
}

/// Parse JSON URLs into CNLabeledValue<NSString> array.
func parseURLs(_ json: String) throws -> [CNLabeledValue<NSString>] {
    let items = try parseJSONArray(json)
    return items.map { item in
        let value = item["value"] as? String ?? ""
        return CNLabeledValue(label: labelConstant(item["label"] as? String), value: value as NSString)
    }
}

/// Parse JSON social profiles into CNLabeledValue<CNSocialProfile> array.
func parseSocialProfiles(_ json: String) throws -> [CNLabeledValue<CNSocialProfile>] {
    let items = try parseJSONArray(json)
    return items.map { item in
        let profile = CNSocialProfile(
            urlString: item["url"] as? String ?? "",
            username: item["username"] as? String ?? "",
            userIdentifier: item["userIdentifier"] as? String ?? "",
            service: item["service"] as? String ?? ""
        )
        return CNLabeledValue(label: labelConstant(item["label"] as? String), value: profile)
    }
}

/// Parse JSON instant messages into CNLabeledValue<CNInstantMessageAddress> array.
func parseInstantMessages(_ json: String) throws -> [CNLabeledValue<CNInstantMessageAddress>] {
    let items = try parseJSONArray(json)
    return items.map { item in
        let im = CNInstantMessageAddress(
            username: item["username"] as? String ?? "",
            service: item["service"] as? String ?? ""
        )
        return CNLabeledValue(label: labelConstant(item["label"] as? String), value: im)
    }
}

/// Parse JSON relations into CNLabeledValue<CNContactRelation> array.
func parseRelations(_ json: String) throws -> [CNLabeledValue<CNContactRelation>] {
    let items = try parseJSONArray(json)
    return items.map { item in
        let name = item["name"] as? String ?? ""
        return CNLabeledValue(label: relationLabelConstant(item["label"] as? String), value: CNContactRelation(name: name))
    }
}

/// Parse JSON dates into CNLabeledValue<NSDateComponents> array.
func parseDates(_ json: String) throws -> [CNLabeledValue<NSDateComponents>] {
    let items = try parseJSONArray(json)
    return items.map { item in
        let comps = NSDateComponents()
        if let year = item["year"] as? Int { comps.year = year }
        if let month = item["month"] as? Int { comps.month = month }
        if let day = item["day"] as? Int { comps.day = day }
        return CNLabeledValue(label: labelConstant(item["label"] as? String), value: comps)
    }
}

/// Parse JSON emails into CNLabeledValue<NSString> array.
func parseEmails(_ json: String) throws -> [CNLabeledValue<NSString>] {
    let items = try parseJSONArray(json)
    return items.map { item in
        let value = item["value"] as? String ?? ""
        return CNLabeledValue(label: labelConstant(item["label"] as? String), value: value as NSString)
    }
}

/// Parse JSON phones into CNLabeledValue<CNPhoneNumber> array.
func parsePhones(_ json: String) throws -> [CNLabeledValue<CNPhoneNumber>] {
    let items = try parseJSONArray(json)
    return items.map { item in
        let value = item["value"] as? String ?? ""
        return CNLabeledValue(label: labelConstant(item["label"] as? String), value: CNPhoneNumber(stringValue: value))
    }
}

func outputJSON(_ value: Any) {
    if let data = try? JSONSerialization.data(withJSONObject: value, options: [.prettyPrinted, .sortedKeys]),
       let string = String(data: data, encoding: .utf8) {
        print(string)
    }
}

/// Check if an error (or any of its underlying errors) is a CoreData merge conflict (code 134092).
func isMergeConflict(_ error: Error) -> Bool {
    var current: NSError? = error as NSError
    while let err = current {
        if err.code == 134092 {
            return true
        }
        current = err.userInfo[NSUnderlyingErrorKey] as? NSError
    }
    return false
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
    CNContactPhoneticGivenNameKey as CNKeyDescriptor,
    CNContactPhoneticMiddleNameKey as CNKeyDescriptor,
    CNContactPhoneticFamilyNameKey as CNKeyDescriptor,
    CNContactPhoneticOrganizationNameKey as CNKeyDescriptor,
    CNContactPreviousFamilyNameKey as CNKeyDescriptor,
    CNContactNonGregorianBirthdayKey as CNKeyDescriptor,
    CNContactDatesKey as CNKeyDescriptor,
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
        // Include all emails and phones as flat arrays for brief listing
        if !contact.emailAddresses.isEmpty {
            dict["emails"] = contact.emailAddresses.map { $0.value as String }
        }
        if !contact.phoneNumbers.isEmpty {
            dict["phones"] = contact.phoneNumbers.map { $0.value.stringValue }
        }
        if !contact.organizationName.isEmpty {
            dict["organization"] = contact.organizationName
        }
        if let birthday = contact.birthday {
            var birthdayDict: [String: Any] = [:]
            if let year = birthday.year { birthdayDict["year"] = year }
            if let month = birthday.month { birthdayDict["month"] = month }
            if let day = birthday.day { birthdayDict["day"] = day }
            dict["birthday"] = birthdayDict
        }
        return dict
    }

    // Full details
    if !contact.middleName.isEmpty { dict["middleName"] = contact.middleName }
    if !contact.namePrefix.isEmpty { dict["namePrefix"] = contact.namePrefix }
    if !contact.nameSuffix.isEmpty { dict["nameSuffix"] = contact.nameSuffix }
    if !contact.nickname.isEmpty { dict["nickname"] = contact.nickname }
    if !contact.previousFamilyName.isEmpty { dict["previousFamilyName"] = contact.previousFamilyName }
    if !contact.phoneticGivenName.isEmpty { dict["phoneticGivenName"] = contact.phoneticGivenName }
    if !contact.phoneticMiddleName.isEmpty { dict["phoneticMiddleName"] = contact.phoneticMiddleName }
    if !contact.phoneticFamilyName.isEmpty { dict["phoneticFamilyName"] = contact.phoneticFamilyName }
    if !contact.phoneticOrganizationName.isEmpty { dict["phoneticOrganizationName"] = contact.phoneticOrganizationName }
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

    if !contact.instantMessageAddresses.isEmpty {
        dict["instantMessages"] = contact.instantMessageAddresses.map { labeled in
            [
                "label": CNLabeledValue<CNInstantMessageAddress>.localizedString(forLabel: labeled.label ?? ""),
                "service": labeled.value.service,
                "username": labeled.value.username
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

    if let nonGregorianBirthday = contact.nonGregorianBirthday {
        var bdayDict: [String: Any] = [:]
        if let year = nonGregorianBirthday.year { bdayDict["year"] = year }
        if let month = nonGregorianBirthday.month { bdayDict["month"] = month }
        if let day = nonGregorianBirthday.day { bdayDict["day"] = day }
        if let cal = nonGregorianBirthday.calendar {
            bdayDict["calendar"] = "\(cal.identifier)"
        }
        dict["nonGregorianBirthday"] = bdayDict
    }

    if !contact.dates.isEmpty {
        dict["dates"] = contact.dates.map { labeled in
            var dateDict: [String: Any] = [
                "label": CNLabeledValue<NSDateComponents>.localizedString(forLabel: labeled.label ?? "")
            ]
            let comps = labeled.value as DateComponents
            if let year = comps.year { dateDict["year"] = year }
            if let month = comps.month { dateDict["month"] = month }
            if let day = comps.day { dateDict["day"] = day }
            return dateDict
        }
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

    // Name fields
    @Option(name: .long, help: "First name")
    var firstName: String?

    @Option(name: .long, help: "Last name")
    var lastName: String?

    @Option(name: .long, help: "Full name (alternative to first/last)")
    var name: String?

    @Option(name: .long, help: "Middle name")
    var middleName: String?

    @Option(name: .long, help: "Name prefix (e.g. Dr., Mr.)")
    var namePrefix: String?

    @Option(name: .long, help: "Name suffix (e.g. Jr., III)")
    var nameSuffix: String?

    @Option(name: .long, help: "Nickname")
    var nickname: String?

    @Option(name: .long, help: "Previous family name (maiden name)")
    var previousFamilyName: String?

    // Phonetic names
    @Option(name: .long, help: "Phonetic first name")
    var phoneticGivenName: String?

    @Option(name: .long, help: "Phonetic middle name")
    var phoneticMiddleName: String?

    @Option(name: .long, help: "Phonetic last name")
    var phoneticFamilyName: String?

    @Option(name: .long, help: "Phonetic organization name")
    var phoneticOrganizationName: String?

    // Organization
    @Option(name: .long, help: "Organization/company name")
    var organization: String?

    @Option(name: .long, help: "Job title")
    var jobTitle: String?

    @Option(name: .long, help: "Department name")
    var department: String?

    // Contact type
    @Option(name: .long, help: "Contact type: person or organization")
    var contactType: String?

    // Simple communication (backward compatible)
    @Option(name: .long, help: "Email address (simple, uses 'work' label)")
    var email: String?

    @Option(name: .long, help: "Phone number (simple, uses 'main' label)")
    var phone: String?

    // Rich labeled arrays (JSON)
    @Option(name: .long, help: "Emails as JSON array: [{\"label\":\"work\",\"value\":\"user@example.com\"}]")
    var emails: String?

    @Option(name: .long, help: "Phones as JSON array: [{\"label\":\"mobile\",\"value\":\"555-0100\"}]")
    var phones: String?

    @Option(name: .long, help: "Addresses as JSON array: [{\"label\":\"home\",\"street\":\"...\",\"city\":\"...\",\"state\":\"...\",\"postalCode\":\"...\",\"country\":\"...\"}]")
    var addresses: String?

    @Option(name: .long, help: "URLs as JSON array: [{\"label\":\"homepage\",\"value\":\"https://...\"}]")
    var urls: String?

    @Option(name: .long, help: "Social profiles as JSON array: [{\"service\":\"Twitter\",\"username\":\"...\",\"url\":\"...\"}]")
    var socialProfiles: String?

    @Option(name: .long, help: "Instant messages as JSON array: [{\"service\":\"Skype\",\"username\":\"...\"}]")
    var instantMessages: String?

    @Option(name: .long, help: "Relations as JSON array: [{\"label\":\"spouse\",\"name\":\"...\"}]")
    var relations: String?

    // Dates
    @Option(name: .long, help: "Birthday (YYYY-MM-DD or MM-DD)")
    var birthday: String?

    @Option(name: .long, help: "Dates as JSON array: [{\"label\":\"anniversary\",\"month\":6,\"day\":15,\"year\":2020}]")
    var dates: String?

    // Notes
    @Option(name: .long, help: "Notes")
    var notes: String?

    func run() async throws {
        try await requestContactsAccess()

        let contact = CNMutableContact()

        // Name
        if let fullName = name {
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

        if let v = middleName { contact.middleName = v }
        if let v = namePrefix { contact.namePrefix = v }
        if let v = nameSuffix { contact.nameSuffix = v }
        if let v = nickname { contact.nickname = v }
        if let v = previousFamilyName { contact.previousFamilyName = v }

        // Phonetic
        if let v = phoneticGivenName { contact.phoneticGivenName = v }
        if let v = phoneticMiddleName { contact.phoneticMiddleName = v }
        if let v = phoneticFamilyName { contact.phoneticFamilyName = v }
        if let v = phoneticOrganizationName { contact.phoneticOrganizationName = v }

        // Organization
        if let org = organization { contact.organizationName = org }
        if let title = jobTitle { contact.jobTitle = title }
        if let dept = department { contact.departmentName = dept }

        // Contact type
        if let ct = contactType?.lowercased() {
            contact.contactType = ct == "organization" ? .organization : .person
        }

        // Emails (JSON array takes priority over simple --email)
        if let emailsJSON = emails {
            contact.emailAddresses = try parseEmails(emailsJSON)
        } else if let emailAddr = email {
            contact.emailAddresses = [CNLabeledValue(label: CNLabelWork, value: emailAddr as NSString)]
        }

        // Phones (JSON array takes priority over simple --phone)
        if let phonesJSON = phones {
            contact.phoneNumbers = try parsePhones(phonesJSON)
        } else if let phoneNum = phone {
            contact.phoneNumbers = [CNLabeledValue(label: CNLabelPhoneNumberMain, value: CNPhoneNumber(stringValue: phoneNum))]
        }

        // Structured arrays
        if let json = addresses { contact.postalAddresses = try parseAddresses(json) }
        if let json = urls { contact.urlAddresses = try parseURLs(json) }
        if let json = socialProfiles { contact.socialProfiles = try parseSocialProfiles(json) }
        if let json = instantMessages { contact.instantMessageAddresses = try parseInstantMessages(json) }
        if let json = relations { contact.contactRelations = try parseRelations(json) }
        if let json = dates { contact.dates = try parseDates(json) }

        // Birthday
        if let birthdayStr = birthday {
            contact.birthday = try parseBirthday(birthdayStr)
        }

        // Notes
        if let note = notes { contact.note = note }

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

    // Name fields
    @Option(name: .long, help: "New first name")
    var firstName: String?

    @Option(name: .long, help: "New last name")
    var lastName: String?

    @Option(name: .long, help: "New middle name")
    var middleName: String?

    @Option(name: .long, help: "New name prefix (e.g. Dr., Mr.)")
    var namePrefix: String?

    @Option(name: .long, help: "New name suffix (e.g. Jr., III)")
    var nameSuffix: String?

    @Option(name: .long, help: "New nickname")
    var nickname: String?

    @Option(name: .long, help: "New previous family name (maiden name)")
    var previousFamilyName: String?

    // Phonetic names
    @Option(name: .long, help: "New phonetic first name")
    var phoneticGivenName: String?

    @Option(name: .long, help: "New phonetic middle name")
    var phoneticMiddleName: String?

    @Option(name: .long, help: "New phonetic last name")
    var phoneticFamilyName: String?

    @Option(name: .long, help: "New phonetic organization name")
    var phoneticOrganizationName: String?

    // Organization
    @Option(name: .long, help: "New organization")
    var organization: String?

    @Option(name: .long, help: "New job title")
    var jobTitle: String?

    @Option(name: .long, help: "New department name")
    var department: String?

    // Contact type
    @Option(name: .long, help: "Contact type: person or organization")
    var contactType: String?

    // Simple communication (backward compatible - replaces primary)
    @Option(name: .long, help: "New email (replaces primary)")
    var email: String?

    @Option(name: .long, help: "New phone (replaces primary)")
    var phone: String?

    // Rich labeled arrays (JSON - replaces ALL entries)
    @Option(name: .long, help: "Replace all emails: [{\"label\":\"work\",\"value\":\"user@example.com\"}]")
    var emails: String?

    @Option(name: .long, help: "Replace all phones: [{\"label\":\"mobile\",\"value\":\"555-0100\"}]")
    var phones: String?

    @Option(name: .long, help: "Replace all addresses: [{\"label\":\"home\",\"street\":\"...\",\"city\":\"...\",\"state\":\"...\",\"postalCode\":\"...\",\"country\":\"...\"}]")
    var addresses: String?

    @Option(name: .long, help: "Replace all URLs: [{\"label\":\"homepage\",\"value\":\"https://...\"}]")
    var urls: String?

    @Option(name: .long, help: "Replace all social profiles: [{\"service\":\"Twitter\",\"username\":\"...\",\"url\":\"...\"}]")
    var socialProfiles: String?

    @Option(name: .long, help: "Replace all instant messages: [{\"service\":\"Skype\",\"username\":\"...\"}]")
    var instantMessages: String?

    @Option(name: .long, help: "Replace all relations: [{\"label\":\"spouse\",\"name\":\"...\"}]")
    var relations: String?

    // Dates
    @Option(name: .long, help: "New birthday (YYYY-MM-DD or MM-DD)")
    var birthday: String?

    @Option(name: .long, help: "Replace all dates: [{\"label\":\"anniversary\",\"month\":6,\"day\":15,\"year\":2020}]")
    var dates: String?

    // Notes
    @Option(name: .long, help: "New notes")
    var notes: String?

    func run() async throws {
        try await requestContactsAccess()

        let maxAttempts = 3
        var attempts = 0

        while true {
            attempts += 1

            let predicate = CNContact.predicateForContacts(withIdentifiers: [id])
            let contacts = try contactStore.unifiedContacts(matching: predicate, keysToFetch: keysToFetch)

            guard let existingContact = contacts.first else {
                throw CLIError.notFound("Contact not found: \(id)")
            }

            let contact = existingContact.mutableCopy() as! CNMutableContact

            // Name fields
            if let first = firstName { contact.givenName = first }
            if let last = lastName { contact.familyName = last }
            if let v = middleName { contact.middleName = v }
            if let v = namePrefix { contact.namePrefix = v }
            if let v = nameSuffix { contact.nameSuffix = v }
            if let v = nickname { contact.nickname = v }
            if let v = previousFamilyName { contact.previousFamilyName = v }

            // Phonetic
            if let v = phoneticGivenName { contact.phoneticGivenName = v }
            if let v = phoneticMiddleName { contact.phoneticMiddleName = v }
            if let v = phoneticFamilyName { contact.phoneticFamilyName = v }
            if let v = phoneticOrganizationName { contact.phoneticOrganizationName = v }

            // Organization
            if let org = organization { contact.organizationName = org }
            if let title = jobTitle { contact.jobTitle = title }
            if let dept = department { contact.departmentName = dept }

            // Contact type
            if let ct = contactType?.lowercased() {
                contact.contactType = ct == "organization" ? .organization : .person
            }

            // Emails (JSON array replaces all; simple --email replaces primary)
            if let emailsJSON = emails {
                contact.emailAddresses = try parseEmails(emailsJSON)
            } else if let emailAddr = email {
                if contact.emailAddresses.isEmpty {
                    contact.emailAddresses = [CNLabeledValue(label: CNLabelWork, value: emailAddr as NSString)]
                } else {
                    var existing = contact.emailAddresses.map { $0.mutableCopy() as! CNLabeledValue<NSString> }
                    existing[0] = CNLabeledValue(label: existing[0].label, value: emailAddr as NSString)
                    contact.emailAddresses = existing
                }
            }

            // Phones (JSON array replaces all; simple --phone replaces primary)
            if let phonesJSON = phones {
                contact.phoneNumbers = try parsePhones(phonesJSON)
            } else if let phoneNum = phone {
                if contact.phoneNumbers.isEmpty {
                    contact.phoneNumbers = [CNLabeledValue(label: CNLabelPhoneNumberMain, value: CNPhoneNumber(stringValue: phoneNum))]
                } else {
                    var existing = contact.phoneNumbers.map { $0.mutableCopy() as! CNLabeledValue<CNPhoneNumber> }
                    existing[0] = CNLabeledValue(label: existing[0].label, value: CNPhoneNumber(stringValue: phoneNum))
                    contact.phoneNumbers = existing
                }
            }

            // Structured arrays (replace all when provided)
            if let json = addresses { contact.postalAddresses = try parseAddresses(json) }
            if let json = urls { contact.urlAddresses = try parseURLs(json) }
            if let json = socialProfiles { contact.socialProfiles = try parseSocialProfiles(json) }
            if let json = instantMessages { contact.instantMessageAddresses = try parseInstantMessages(json) }
            if let json = relations { contact.contactRelations = try parseRelations(json) }
            if let json = dates { contact.dates = try parseDates(json) }

            // Birthday
            if let birthdayStr = birthday {
                contact.birthday = try parseBirthday(birthdayStr)
            }

            // Notes (guarded: macOS may restrict note access via TCC)
            if let note = notes {
                if existingContact.isKeyAvailable(CNContactNoteKey) {
                    contact.note = note
                } else {
                    fputs("Warning: Cannot set notes — Contacts note access not available. Check System Settings > Privacy & Security > Contacts.\n", stderr)
                }
            }

            let saveRequest = CNSaveRequest()
            saveRequest.update(contact)

            do {
                try contactStore.execute(saveRequest)
            } catch {
                // CoreData 134092 = NSManagedObjectMergeError (iCloud sync conflict)
                // May appear at top level or nested in underlyingErrors
                if isMergeConflict(error) && attempts < maxAttempts {
                    fputs("Warning: Merge conflict (attempt \(attempts)/\(maxAttempts)). Re-fetching and retrying...\n", stderr)
                    try await Task.sleep(nanoseconds: 500_000_000) // 0.5s
                    continue
                }
                throw error
            }

            outputJSON([
                "success": true,
                "message": "Contact updated successfully",
                "contact": contactToDict(contact, brief: false)
            ])
            return
        }
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
