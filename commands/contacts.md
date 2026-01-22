---
description: Manage macOS contacts - list, search, get details, create, update, delete
argument-hint: "[groups|list|search|get|create|update|delete] [options]"
allowed-tools:
  - mcp__apple-pim__contact_groups
  - mcp__apple-pim__contact_list
  - mcp__apple-pim__contact_search
  - mcp__apple-pim__contact_get
  - mcp__apple-pim__contact_create
  - mcp__apple-pim__contact_update
  - mcp__apple-pim__contact_delete
---

# Contact Management

Manage contacts using the Apple Contacts framework.

## Available Operations

When the user runs this command, determine which operation they need and use the appropriate MCP tool:

### List Groups
Use `contact_groups` to show all contact groups.

### List Contacts
Use `contact_list` to list contacts:
- Optional: `group` (filter by group), `limit`
- Returns brief contact info (name, primary email, phone)

### Search Contacts
Use `contact_search` to find contacts by name, email, or phone:
- Required: `query` (search term)
- Optional: `limit`

### Get Contact Details
Use `contact_get` to get full details for a contact:
- Required: `id` (contact ID from list/search)
- Returns all fields: emails, phones, addresses, birthday, notes, etc.

### Create Contact
Use `contact_create` to create a new contact:
- Optional: `name` (full name) OR `firstName`/`lastName`
- Optional: `email`, `phone`, `organization`, `jobTitle`, `notes`

### Update Contact
Use `contact_update` to modify an existing contact:
- Required: `id` (contact ID)
- Optional: `firstName`, `lastName`, `email`, `phone`, `organization`, `jobTitle`, `notes`

### Delete Contact
Use `contact_delete` to remove a contact:
- Required: `id` (contact ID)

## Examples

**List contact groups:**
```
/apple-pim:contacts groups
```

**List contacts:**
```
/apple-pim:contacts list
/apple-pim:contacts list --group "Work"
```

**Search contacts:**
```
/apple-pim:contacts search "John"
/apple-pim:contacts search "smith@example.com"
/apple-pim:contacts search "555-1234"
```

**Get contact details:**
```
/apple-pim:contacts get --id <contact_id>
```

**Create a contact:**
```
/apple-pim:contacts create --name "Jane Doe" --email "jane@example.com"
/apple-pim:contacts create --first-name "John" --last-name "Smith" --phone "555-1234" --organization "Acme Corp"
```

**Update a contact:**
```
/apple-pim:contacts update --id <contact_id> --email "new@example.com"
/apple-pim:contacts update --id <contact_id> --job-title "Senior Engineer"
```

**Delete a contact:**
```
/apple-pim:contacts delete --id <contact_id>
```

## Parsing User Intent

When a user provides natural language, map to the appropriate operation:
- "Find John's email" → `contact_search` with query "John", then display email
- "What's Sarah's phone number?" → `contact_search` with query "Sarah"
- "Show me John Smith's contact info" → `contact_search`, then `contact_get` for full details
- "Add a contact for the new client" → `contact_create` (ask for details if needed)
- "Update my dentist's phone number" → `contact_search` for "dentist", then `contact_update`
- "Who works at Acme?" → `contact_search` with query "Acme"

## Notes

- Search is flexible: matches name, email addresses, and phone numbers
- When updating email/phone, the primary (first) value is replaced
- Group filtering shows contacts assigned to that specific group
- Contact IDs are stable identifiers returned by list/search operations
