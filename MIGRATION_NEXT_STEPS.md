# Migration Next Steps

## Immediate Actions Required

### 1. Restart Payload CMS Server

The access control has been updated to allow updates and creates. **You must restart the Payload CMS server** for these changes to take effect:

```bash
# In the terminal running Payload CMS, stop it (Ctrl+C)
# Then restart:
cd litecoin-fund-cms
npm run dev
```

### 2. Run Data Refresh

After restarting, refresh the outdated data:

```bash
cd litecoin-fund-cms
npx tsx scripts/refresh-from-webflow-api.ts
```

This will update all 31 contributors and 23 projects with the latest data from Webflow.

### 3. Migrate Images

Once data is refreshed, migrate all images:

```bash
cd litecoin-fund-cms
npx tsx scripts/migrate-images.ts
```

This will:
- Download 31 contributor profile pictures from Webflow CDN
- Download 22 project cover images from Webflow CDN
- Upload them to Payload CMS Media collection
- Link them to the respective contributors and projects

### 4. Verify Results

After migration, verify everything is complete:

```bash
cd litecoin-fund-cms
npx tsx scripts/audit-payload-data-api.ts
```

Expected results:
- All 31 contributors should have profile pictures
- All 23 projects should have cover images
- Data should match Webflow

## Scripts Available

1. **`scripts/audit-payload-data-api.ts`** - Check current data state
2. **`scripts/compare-webflow-payload.ts`** - Compare Webflow vs Payload
3. **`scripts/refresh-from-webflow-api.ts`** - Update existing records
4. **`scripts/identify-missing-images.ts`** - List missing images
5. **`scripts/migrate-images.ts`** - Download and upload images

## Troubleshooting

### If you still get 403 errors:

1. Verify Payload CMS server is restarted
2. Check that access control changes are saved
3. Verify `PAYLOAD_API_TOKEN` is set in `.env` (though it may not be needed with open access)

### If images fail to upload:

1. Check internet connection (needs to download from Webflow CDN)
2. Verify Payload CMS Media collection has create access
3. Check server logs for errors

### If images upload but don't link:

1. Verify update access is enabled on Contributors and Projects collections
2. Check that server was restarted after access control changes
3. Review script output for specific error messages

## Completion Checklist

- [ ] Restart Payload CMS server
- [ ] Run data refresh script
- [ ] Run image migration script
- [ ] Verify all images are linked
- [ ] Run audit script to confirm completeness
- [ ] Test data integrity (relationships, required fields)
