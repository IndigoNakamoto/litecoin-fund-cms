# Image Migration Notes

## Current Issue

The automated image migration script is encountering an issue with the Payload CMS 3.x API format. The `alt` field (required) is not being received by the server, even though it's being sent in the FormData.

**Error:** `"Alt" field is required` - despite the field being included in the multipart form data.

## Workaround Options

### Option 1: Manual Upload via Admin Panel (Recommended for now)

1. Access Payload CMS admin: `http://localhost:3001/admin`
2. Go to Media collection
3. For each image:
   - Click "Create New"
   - Upload the image file (download from Webflow CDN URLs listed in `identify-missing-images.ts` output)
   - Enter alt text
   - Save
   - Note the Media ID
4. Link to projects/contributors:
   - Edit each project/contributor
   - Select the uploaded media for coverImage/profilePicture
   - Save

### Option 2: Use Payload Local API (getPayload)

Instead of REST API, use the Payload instance directly:

```typescript
import { getPayload } from 'payload'
import { default as config } from '../src/payload.config.js'

const payload = await getPayload({ config })

// Upload file
const media = await payload.create({
  collection: 'media',
  data: {
    alt: 'Image alt text',
    file: imageBuffer, // May need to be a file path or stream
  },
  file: {
    data: imageBuffer,
    mimetype: 'image/jpeg',
    name: 'filename.jpg',
  },
})
```

### Option 3: Fix FormData Format

The issue might be:
- FormData field order
- Content-Type header handling
- Field encoding

Need to investigate Payload 3.x specific multipart format requirements.

## Image URLs Reference

All 53 missing images have been identified:
- 31 contributor profile pictures
- 22 project cover images

URLs are available in the output of:
```bash
npx tsx scripts/identify-missing-images.ts
```

## Status

- ✅ Data refresh: Complete (31 contributors, 23 projects updated)
- ⚠️ Image upload: Blocked by API format issue
- ⚠️ Image linking: Pending image upload

## Next Steps

1. Investigate Payload 3.x file upload API format
2. Or implement Option 2 (local API approach)
3. Or proceed with manual upload (Option 1)
