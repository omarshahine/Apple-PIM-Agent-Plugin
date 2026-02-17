# Contacts Framework API Reference

## CNContact Properties

Key contact fields:

| Property | Type | Description |
|----------|------|-------------|
| `identifier` | String | Unique identifier |
| `givenName` | String | First name |
| `familyName` | String | Last name |
| `middleName` | String | Middle name |
| `namePrefix` | String | Mr., Dr., etc. |
| `nameSuffix` | String | Jr., PhD, etc. |
| `nickname` | String | Nickname |
| `organizationName` | String | Company |
| `jobTitle` | String | Job title |
| `departmentName` | String | Department |
| `emailAddresses` | [CNLabeledValue<NSString>] | Email addresses |
| `phoneNumbers` | [CNLabeledValue<CNPhoneNumber>] | Phone numbers |
| `postalAddresses` | [CNLabeledValue<CNPostalAddress>] | Addresses |
| `urlAddresses` | [CNLabeledValue<NSString>] | URLs |
| `birthday` | DateComponents? | Birthday |
| `note` | String | Notes |
| `imageData` | Data? | Contact photo |
| `contactRelations` | [CNLabeledValue<CNContactRelation>] | Related people |
| `socialProfiles` | [CNLabeledValue<CNSocialProfile>] | Social accounts |

## Labeled Values

Multi-value properties use `CNLabeledValue<T>`:

```swift
// Standard labels
CNLabelHome, CNLabelWork, CNLabelOther
CNLabelPhoneNumberMain, CNLabelPhoneNumberMobile
CNLabelEmailiCloud
```

## Contact Groups

`CNGroup` represents contact groups:

| Property | Type | Description |
|----------|------|-------------|
| `identifier` | String | Unique identifier |
| `name` | String | Group name |

## Authorization

```swift
let status = CNContactStore.authorizationStatus(for: .contacts)
try await contactStore.requestAccess(for: .contacts)
```

## Search Predicates

- Name search: `CNContact.predicateForContacts(matchingName:)`
- ID lookup: `CNContact.predicateForContacts(withIdentifiers:)`
