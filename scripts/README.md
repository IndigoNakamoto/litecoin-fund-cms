# Migration Scripts

## migrate-from-webflow.ts

This script migrates data from Webflow CMS to Payload CMS.

### Prerequisites

1. **Environment Variables**: Make sure you have the following environment variables set in your `.env` file:

   ```env
   # Webflow API credentials
   WEBFLOW_API_TOKEN=your_webflow_api_token
   WEBFLOW_COLLECTION_ID_PROJECTS=your_projects_collection_id
   WEBFLOW_COLLECTION_ID_CONTRIBUTORS=your_contributors_collection_id
   WEBFLOW_COLLECTION_ID_FAQS=your_faqs_collection_id
   WEBFLOW_COLLECTION_ID_POSTS=your_posts_collection_id
   WEBFLOW_COLLECTION_ID_PROJECT_UPDATES=your_updates_collection_id
   WEBFLOW_COLLECTION_ID_MATCHING_DONORS=your_matching_donors_collection_id

   # Payload CMS configuration
   DATABASE_URI=postgresql://user@localhost:5432/payload_cms
   PAYLOAD_SECRET=your_payload_secret
   ```

2. **Database**: Ensure your PostgreSQL database is running and accessible.

3. **Payload CMS**: The Payload CMS project should be set up and the database schema should be initialized.

### Usage

Run the migration script:

```bash
cd litecoin-fund-cms
npm run migrate
```

Or directly with tsx:

```bash
npx tsx scripts/migrate-from-webflow.ts
```

### What it does

The script migrates data in the following order:

1. **Contributors**: Migrates all active (non-draft, non-archived) contributors from Webflow
2. **Projects**: Migrates all published projects and links them to contributors
3. **FAQs**: Migrates FAQs and links them to projects
4. **Posts**: Migrates social media posts and links them to projects
5. **Updates**: Migrates project updates and links them to projects

## migrate-matching-donors.ts

This script migrates Matching Donors from Webflow to Payload CMS.

### Usage

```bash
cd litecoin-fund-cms
npx tsx scripts/migrate-matching-donors.ts
```

### What it does

- Fetches all matching donors from Webflow
- Maps option fields (status, matching-type) to Payload values
- Links to existing projects and contributors in Payload
- Creates or updates matching donors in Payload CMS

### Required Environment Variables

In addition to the standard Webflow variables, you need:

```env
WEBFLOW_COLLECTION_ID_MATCHING_DONORS=your_matching_donors_collection_id
```

You can find this value in the legacy project's `.env` file.

### Features

- **Idempotent**: The script checks if items already exist by slug and skips duplicates
- **Relationship Mapping**: Automatically maps Webflow IDs to Payload IDs for relationships
- **Error Handling**: Continues processing even if individual items fail
- **Progress Logging**: Shows detailed progress for each migration step

### Notes

- **Rich Text**: Plain text content is converted to Lexical editor format
- **Images**: Profile pictures and cover images are not automatically migrated (URLs are preserved in the data, but files need to be uploaded separately to the Media collection)
- **Status Mapping**: Project statuses are normalized to match Payload's status options (active, completed, paused, archived)

### Troubleshooting

If you encounter errors:

1. **Database Connection**: Verify your `DATABASE_URI` is correct and the database is running
2. **Webflow API**: Check that your `WEBFLOW_API_TOKEN` is valid and has access to the collections
3. **Rate Limiting**: The script includes rate limit handling with automatic retries
4. **Missing Fields**: Some optional fields may be missing from Webflow - the script handles this gracefully

