# Contributor Migration Fix

## Problem
Many contributors from Webflow were missing in Payload CMS. This was due to several issues:

1. **Only Active Contributors Were Migrated**: The migration script only processed active (non-draft, non-archived) contributors, but projects may reference archived or draft contributors.

2. **Incomplete Matching Logic**: The script tried to match contributors by slug, but if slugs didn't match exactly (after sanitization), contributors wouldn't be found and would be duplicated.

3. **Missing Field Variations**: The script didn't check for both field name variations (`bitcoin-contributors` vs `bitcoin-contributors-2`, etc.).

## Solution

### Updated `refresh-from-webflow-api.ts`

1. **Migrate All Non-Archived Contributors**: Now includes ALL non-archived contributors (active + drafts), matching what Webflow shows on the `/projects` page in the "Project Builders" section. Only archived contributors are excluded.

2. **Improved Matching Logic**: 
   - Tries matching by sanitized slug
   - Falls back to matching by name (case-insensitive)
   - Tries original slug variations
   - Better handles edge cases

3. **Check Both Field Variations**: Updated project contributor field mapping to check both `-2` and original field names.

4. **Better Logging**: Added detailed logging showing which contributors are being processed and their status (active/archived/draft).

### New Diagnostic Script

Created `find-missing-contributors.ts` to help identify missing contributors:
- Shows total contributors in Webflow vs Payload
- Lists missing active contributors
- Shows contributors referenced in projects but missing from Payload
- Identifies orphaned contributors in Payload not in Webflow

## Usage

### 1. Diagnose Missing Contributors

```bash
cd litecoin-fund-cms
npx tsx scripts/find-missing-contributors.ts
```

This will show you:
- How many contributors are missing
- Which contributors are referenced in projects but not migrated
- Any orphaned contributors in Payload

### 2. Fix Missing Contributors

```bash
cd litecoin-fund-cms
npx tsx scripts/refresh-from-webflow-api.ts
```

This will:
- Migrate all active contributors
- Migrate any archived/draft contributors that are referenced in projects
- Update existing contributors with latest data
- Better match contributors to avoid duplicates

## Expected Results

After running the refresh script, you should see:
- All active contributors migrated
- All contributors referenced in projects migrated (even if archived/draft)
- Better matching to avoid duplicates
- Detailed logs showing what was created/updated

## Notes

- The script now processes contributors referenced in projects, even if they're archived/draft
- Contributors are matched by multiple strategies (slug, name, etc.) to avoid duplicates
- The script handles both field name variations (`bitcoin-contributors` and `bitcoin-contributors-2`)
- Contributors that can't be matched will be created as new records
