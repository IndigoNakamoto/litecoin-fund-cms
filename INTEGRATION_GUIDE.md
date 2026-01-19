# Payload CMS Integration Guide

This guide explains how to integrate the Payload CMS instance with the `litecoin-fund` project to replace Webflow.

## Overview

The Payload CMS project is located in `/migrate/payload-cms` and provides a headless CMS for managing:
- **Projects** - Full project management with all metadata, social links, and contributors
- **Contributors** - Contributor profiles with social links
- **FAQs** - Project-specific FAQs
- **Posts** - Social media posts linked to projects
- **Updates** - Project updates and announcements
- **Media** - File uploads (images, etc.)
- **Users** - Admin users for Payload CMS

## Setup

### 1. Payload CMS Setup

1. Navigate to the Payload CMS directory:
   ```bash
   cd migrate/payload-cms
   ```

2. Install dependencies (if not already done):
   ```bash
   npm install
   ```

3. Set up environment variables:
   The `.env` file should already be configured with:
   - `DATABASE_URI`: PostgreSQL connection string
   - `PAYLOAD_SECRET`: Secret key for Payload
   - `NEXT_PUBLIC_SERVER_URL`: Server URL (e.g., `http://localhost:3000`)

4. Generate TypeScript types:
   ```bash
   npm run generate:types
   ```

5. Start the Payload CMS server:
   ```bash
   npm run dev
   ```

   Access the admin panel at `http://localhost:3000/admin`

### 2. Litecoin Fund Integration

The integration service layer is already created in `litecoin-fund/services/payload/`. To switch from Webflow to Payload:

1. **Update environment variables** in `litecoin-fund/.env.local`:
   ```env
   # Payload CMS Configuration
   PAYLOAD_API_URL=http://localhost:3000/api
   PAYLOAD_API_TOKEN=your-api-token-if-needed
   ```

2. **Update imports** in your pages/components:

   **Before (Webflow):**
   ```typescript
   import { getProjectBySlug } from '@/services/webflow/projects'
   import { getFAQsByProjectSlug } from '@/services/webflow/faqs'
   ```

   **After (Payload):**
   ```typescript
   import { getProjectBySlug } from '@/services/payload/projects'
   import { getFAQsByProjectSlug } from '@/services/payload/faqs'
   ```

3. **Example: Update project page** (`app/projects/[slug]/page.tsx`):
   ```typescript
   // Replace Webflow imports with Payload imports
   import { getProjectBySlug } from '@/services/payload/projects'
   import { getFAQsByProjectSlug } from '@/services/payload/faqs'
   import { getPostsByProjectSlug } from '@/services/payload/posts'
   import { getUpdatesByProjectSlug } from '@/services/payload/updates'
   ```

## API Compatibility

The Payload service layer maintains the same function signatures as the Webflow service layer, so minimal code changes are needed:

- `getAllPublishedProjects()` - Returns all published projects
- `getProjectBySlug(slug)` - Get project by slug
- `getProjectSummaries()` - Get lightweight project summaries
- `getFAQsByProjectSlug(slug)` - Get FAQs for a project
- `getPostsByProjectSlug(slug)` - Get posts for a project
- `getUpdatesByProjectSlug(slug)` - Get updates for a project
- `getAllActiveContributors()` - Get all contributors
- `getContributorsByIds(ids)` - Get contributors by IDs

## Collections Structure

### Projects
- All fields from Webflow are mapped
- Relationships to Contributors (bitcoin, litecoin, advocates)
- Status field with options: active, completed, paused, archived
- Social links (GitHub, Twitter, Discord, Telegram, Reddit, Facebook, Website)
- Financial data (total paid, service fees)

### Contributors
- Profile information and social links
- Can be linked to multiple projects

### FAQs
- Linked to projects via relationship
- Order field for sorting
- Rich text answers

### Posts
- Social media links (X, YouTube, Reddit)
- Can be linked to multiple projects

### Updates
- Project updates with rich text content
- Date, author, tags

## Running Both Services

During migration, you can run both services:

1. **Payload CMS** (port 3000):
   ```bash
   cd migrate/payload-cms
   npm run dev
   ```

2. **Litecoin Fund** (port 3001 or different):
   ```bash
   cd litecoin-fund
   npm run dev
   ```

## Testing

1. Test Payload CMS admin panel at `http://localhost:3000/admin`
2. Create test projects, FAQs, etc.
3. Test API endpoints: `http://localhost:3000/api/projects`
4. Test integration in litecoin-fund by switching imports

## Production Deployment

1. Deploy Payload CMS to a hosting service (Vercel, Railway, etc.)
2. Update `PAYLOAD_API_URL` in litecoin-fund to point to production
3. Set up environment variables in production
4. Configure database (PostgreSQL) for production

## Troubleshooting

### CORS Issues
If you encounter CORS issues, configure Payload to allow requests from your frontend domain.

### Authentication
If using API tokens, ensure `PAYLOAD_API_TOKEN` is set in litecoin-fund environment.

### Database Connection
Ensure PostgreSQL is running and `DATABASE_URI` is correct.
