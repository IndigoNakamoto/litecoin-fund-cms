/**
 * Migration script to import data from Webflow to Payload CMS
 * 
 * Usage:
 *   cd payload-cms
 *   npx tsx scripts/migrate-from-webflow.ts
 * 
 * Make sure to set environment variables:
 *   - WEBFLOW_API_TOKEN
 *   - WEBFLOW_COLLECTION_ID_PROJECTS
 *   - WEBFLOW_COLLECTION_ID_CONTRIBUTORS
 *   - WEBFLOW_COLLECTION_ID_FAQS
 *   - WEBFLOW_COLLECTION_ID_POSTS
 *   - WEBFLOW_COLLECTION_ID_PROJECT_UPDATES
 *   - DATABASE_URI (for Payload)
 *   - PAYLOAD_SECRET
 */

// Load environment variables FIRST, before any other imports
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
dotenv.config({ path: path.resolve(__dirname, '../.env') })

// Verify required environment variables are loaded
if (!process.env.PAYLOAD_SECRET) {
  console.error('❌ Error: PAYLOAD_SECRET is not set in .env file')
  process.exit(1)
}

if (!process.env.DATABASE_URI) {
  console.error('❌ Error: DATABASE_URI is not set in .env file')
  process.exit(1)
}

// Now import other modules that might use environment variables
import { getPayload } from 'payload'
import axios from 'axios'

// Webflow API client
function createWebflowClient(apiToken: string) {
  return axios.create({
    baseURL: 'https://api.webflow.com/v2',
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'accept-version': '1.0.0',
      'Content-Type': 'application/json',
    },
  })
}

// Fetch all items from a Webflow collection
async function listCollectionItems<T>(
  client: ReturnType<typeof createWebflowClient>,
  collectionId: string
): Promise<T[]> {
  const allItems: T[] = []
  let offset = 0
  const limit = 100

  while (true) {
    try {
      const response = await client.get(`/collections/${collectionId}/items`, {
        params: {
          limit,
          offset,
        },
      })

      const { items } = response.data
      allItems.push(...items)

      if (items.length < limit) {
        break
      }

      offset += limit
    } catch (error: any) {
      if (error.response?.status === 429) {
        console.warn('Rate limited, waiting 5 seconds...')
        await new Promise((resolve) => setTimeout(resolve, 5000))
        continue
      }
      throw error
    }
  }

  return allItems
}

// Webflow types
interface WebflowContributor {
  id: string
  slug: string
  isDraft: boolean
  isArchived: boolean
  fieldData: {
    name?: string
    slug?: string
    'profile-picture'?: {
      fileId: string
      url: string
      alt: string | null
    }
    'twitter-link'?: string
    'discord-link'?: string
    'github-link'?: string
    'youtube-link'?: string
    'linkedin-link'?: string
    email?: string
  }
}

interface WebflowProject {
  id: string
  slug: string
  isDraft: boolean
  isArchived: boolean
  fieldData: {
    name: string
    slug?: string
    summary: string
    content?: string
    'cover-image'?: {
      fileId: string
      url: string
      alt: string | null
    }
    status: string
    'project-type'?: string
    hidden: boolean
    recurring: boolean
    'total-paid': number
    'service-fees-collected': number
    'website-link'?: string
    'github-link'?: string
    'twitter-link'?: string
    'discord-link'?: string
    'telegram-link'?: string
    'reddit-link'?: string
    'facebook-link'?: string
    'bitcoin-contributors'?: string[]
    'litecoin-contributors'?: string[]
    advocates?: string[]
    hashtags?: string[]
  }
}

interface WebflowFAQ {
  id: string
  isDraft: boolean
  isArchived: boolean
  fieldData: {
    question?: string
    name?: string
    answer?: string
    project?: string
    order?: number
    category?: string
  }
}

interface WebflowPost {
  id: string
  isDraft: boolean
  isArchived: boolean
  fieldData: {
    'x-post-link'?: string
    'youtube-link'?: string
    'reddit-link'?: string
    projects?: string[]
  }
}

interface WebflowUpdate {
  id: string
  isDraft: boolean
  isArchived: boolean
  fieldData: {
    name?: string
    title?: string
    summary?: string
    content?: string
    project?: string
    createdOn?: string
    date?: string
    authorTwitterHandle?: string
    tags?: string[]
  }
}

// Map to store Webflow ID -> Payload ID (Payload Postgres default IDs are numeric)
const contributorIdMap = new Map<string, number>()
const projectIdMap = new Map<string, number>()

/**
 * Convert plain text or HTML to a basic Lexical editor format
 * This is a simplified version - for complex HTML, you might want to use a proper HTML-to-Lexical converter
 */
function textToLexical(text: string | undefined): any {
  if (!text) {
    return {
      root: {
        children: [
          {
            children: [],
            direction: 'ltr',
            format: '',
            indent: 0,
            type: 'paragraph',
            version: 1,
          },
        ],
        direction: 'ltr',
        format: '',
        indent: 0,
        type: 'root',
        version: 1,
      },
    }
  }

  // Simple conversion: split by newlines and create paragraphs
  const lines = text.split('\n').filter((line) => line.trim().length > 0)
  
  if (lines.length === 0) {
    return {
      root: {
        children: [
          {
            children: [],
            direction: 'ltr',
            format: '',
            indent: 0,
            type: 'paragraph',
            version: 1,
          },
        ],
        direction: 'ltr',
        format: '',
        indent: 0,
        type: 'root',
        version: 1,
      },
    }
  }

  return {
    root: {
      children: lines.map((line) => ({
        children: [
          {
            detail: 0,
            format: 0,
            mode: 'normal',
            style: '',
            text: line.trim(),
            type: 'text',
            version: 1,
          },
        ],
        direction: 'ltr',
        format: '',
        indent: 0,
        type: 'paragraph',
        version: 1,
      })),
      direction: 'ltr',
      format: '',
      indent: 0,
      type: 'root',
      version: 1,
    },
  }
}

async function migrateContributors(payload: Awaited<ReturnType<typeof getPayload>>) {
  console.log('\n📦 Migrating Contributors...')
  
  const apiToken = process.env.WEBFLOW_API_TOKEN
  const collectionId = process.env.WEBFLOW_COLLECTION_ID_CONTRIBUTORS

  if (!apiToken || !collectionId) {
    console.warn('⚠️  Webflow API credentials not configured for contributors, skipping...')
    return
  }

  const client = createWebflowClient(apiToken)
  const webflowContributors = await listCollectionItems<WebflowContributor>(client, collectionId)

  // Filter to only active contributors
  const activeContributors = webflowContributors.filter(
    (c) => !c.isDraft && !c.isArchived
  )

  console.log(`Found ${activeContributors.length} active contributors`)

  for (const webflowContributor of activeContributors) {
    try {
      const name = webflowContributor.fieldData.name || 'Unknown Contributor'
      const slug = webflowContributor.fieldData.slug || webflowContributor.slug || webflowContributor.id

      // Validate slug - must be a valid URL-friendly string
      if (!slug || slug.trim().length === 0) {
        console.warn(`  ⚠️  Skipping contributor "${name}" - missing slug`)
        continue
      }

      // Sanitize slug - remove invalid characters
      const sanitizedSlug = slug
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')

      if (!sanitizedSlug || sanitizedSlug.length === 0) {
        console.warn(`  ⚠️  Skipping contributor "${name}" - invalid slug after sanitization`)
        continue
      }

      // Check if contributor already exists by slug
      const existing = await payload.find({
        collection: 'contributors',
        where: {
          slug: {
            equals: sanitizedSlug,
          },
        },
        limit: 1,
      })

      if (existing.docs.length > 0) {
        console.log(`  ✓ Contributor "${name}" already exists, skipping`)
        contributorIdMap.set(webflowContributor.id, existing.docs[0].id)
        continue
      }

      // Upgrade path: older migrations stored slug as the Webflow item ID
      const legacy = await payload.find({
        collection: 'contributors',
        where: {
          slug: {
            equals: webflowContributor.id,
          },
        },
        limit: 1,
      })

      if (legacy.docs.length > 0) {
        const updated = await payload.update({
          collection: 'contributors',
          id: legacy.docs[0].id,
          data: {
            slug: sanitizedSlug,
          },
        })

        contributorIdMap.set(webflowContributor.id, updated.id)
        console.log(`  ✓ Updated contributor slug: ${name} -> ${sanitizedSlug}`)
        continue
      }

      const contributor = await payload.create({
        collection: 'contributors',
        data: {
          name: name,
          slug: sanitizedSlug,
          twitterLink: webflowContributor.fieldData['twitter-link'],
          discordLink: webflowContributor.fieldData['discord-link'],
          githubLink: webflowContributor.fieldData['github-link'],
          youtubeLink: webflowContributor.fieldData['youtube-link'],
          linkedinLink: webflowContributor.fieldData['linkedin-link'],
          email: webflowContributor.fieldData.email,
          // Note: profilePicture would need to be uploaded first to media collection
        },
      })

      contributorIdMap.set(webflowContributor.id, contributor.id)
      console.log(`  ✓ Created contributor: ${contributor.name}`)
    } catch (error: any) {
      const name = webflowContributor.fieldData.name || webflowContributor.slug || 'Unknown'
      console.error(`  ✗ Error creating contributor "${name}":`, error.message)
      if (error.data) {
        console.error(`    Details:`, JSON.stringify(error.data, null, 2))
      }
    }
  }

  console.log(`✅ Migrated ${contributorIdMap.size} contributors\n`)
}

async function migrateProjects(payload: Awaited<ReturnType<typeof getPayload>>) {
  console.log('\n📦 Migrating Projects...')
  
  const apiToken = process.env.WEBFLOW_API_TOKEN
  const collectionId = process.env.WEBFLOW_COLLECTION_ID_PROJECTS

  if (!apiToken || !collectionId) {
    console.warn('⚠️  Webflow API credentials not configured for projects, skipping...')
    return
  }

  const client = createWebflowClient(apiToken)
  const webflowProjects = await listCollectionItems<WebflowProject>(client, collectionId)

  // Filter to only published, non-hidden projects
  const publishedProjects = webflowProjects.filter(
    (p) => !p.isDraft && !p.isArchived && !p.fieldData.hidden
  )

  console.log(`Found ${publishedProjects.length} published projects`)

  // Map status from Webflow to Payload
  const statusMap: Record<string, string> = {
    // Add common status mappings here if needed
  }

  // Map Webflow project types to Payload project types
  const projectTypeMap: Record<string, 'open-source' | 'research' | 'education' | 'infrastructure'> = {
    'open-source': 'open-source',
    'opensource': 'open-source',
    'open source': 'open-source',
    'research': 'research',
    'education': 'education',
    'infrastructure': 'infrastructure',
    'infra': 'infrastructure',
  }

  for (const webflowProject of publishedProjects) {
    try {
      const name = webflowProject.fieldData.name || 'Unknown Project'
      const slug = webflowProject.fieldData.slug || webflowProject.slug || webflowProject.id

      // Validate and sanitize slug
      if (!slug || slug.trim().length === 0) {
        console.warn(`  ⚠️  Skipping project "${name}" - missing slug`)
        continue
      }

      const sanitizedSlug = slug
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')

      if (!sanitizedSlug || sanitizedSlug.length === 0) {
        console.warn(`  ⚠️  Skipping project "${name}" - invalid slug after sanitization`)
        continue
      }

      // Check if project already exists by slug
      const existing = await payload.find({
        collection: 'projects',
        where: {
          slug: {
            equals: sanitizedSlug,
          },
        },
        limit: 1,
      })

      if (existing.docs.length > 0) {
        console.log(`  ✓ Project "${name}" already exists, skipping`)
        projectIdMap.set(webflowProject.id, existing.docs[0].id)
        continue
      }

      // Upgrade path: older migrations stored slug as the Webflow item ID
      const legacy = await payload.find({
        collection: 'projects',
        where: {
          slug: {
            equals: webflowProject.id,
          },
        },
        limit: 1,
      })

      if (legacy.docs.length > 0) {
        const updated = await payload.update({
          collection: 'projects',
          id: legacy.docs[0].id,
          data: {
            slug: sanitizedSlug,
          },
        })

        projectIdMap.set(webflowProject.id, updated.id)
        console.log(`  ✓ Updated project slug: ${name} -> ${sanitizedSlug}`)
        continue
      }

      // Map contributor IDs
      const bitcoinContributorIds = webflowProject.fieldData['bitcoin-contributors']
        ?.map((id) => contributorIdMap.get(id))
        .filter((id): id is number => typeof id === 'number') || []

      const litecoinContributorIds = webflowProject.fieldData['litecoin-contributors']
        ?.map((id) => contributorIdMap.get(id))
        .filter((id): id is number => typeof id === 'number') || []

      const advocateIds = webflowProject.fieldData.advocates
        ?.map((id) => contributorIdMap.get(id))
        .filter((id): id is number => typeof id === 'number') || []

      // Map status - try to normalize common values
      let status = (webflowProject.fieldData.status || '').toLowerCase()
      if (!['active', 'completed', 'paused', 'archived'].includes(status)) {
        // Try to map common status values
        if (status.includes('active') || status.includes('live')) status = 'active'
        else if (status.includes('complete') || status.includes('done')) status = 'completed'
        else if (status.includes('pause') || status.includes('hold')) status = 'paused'
        else if (status.includes('archive')) status = 'archived'
        else status = 'active' // default
      }

      // Map project type
      let projectType: 'open-source' | 'research' | 'education' | 'infrastructure' | undefined
      const webflowProjectType = (webflowProject.fieldData['project-type'] || '').toLowerCase().trim()
      if (webflowProjectType) {
        projectType = projectTypeMap[webflowProjectType] || undefined
      }

      const project = await payload.create({
        collection: 'projects',
        data: {
          name: name,
          slug: sanitizedSlug,
          summary: webflowProject.fieldData.summary || '',
          content: textToLexical(webflowProject.fieldData.content),
          status: status as 'active' | 'completed' | 'paused' | 'archived',
          projectType: projectType,
          hidden: webflowProject.fieldData.hidden || false,
          recurring: webflowProject.fieldData.recurring || false,
          totalPaid: webflowProject.fieldData['total-paid'] || 0,
          serviceFeesCollected: webflowProject.fieldData['service-fees-collected'] || 0,
          website: webflowProject.fieldData['website-link'],
          github: webflowProject.fieldData['github-link'],
          twitter: webflowProject.fieldData['twitter-link'],
          discord: webflowProject.fieldData['discord-link'],
          telegram: webflowProject.fieldData['telegram-link'],
          reddit: webflowProject.fieldData['reddit-link'],
          facebook: webflowProject.fieldData['facebook-link'],
          bitcoinContributors: bitcoinContributorIds.length > 0 ? bitcoinContributorIds : undefined,
          litecoinContributors: litecoinContributorIds.length > 0 ? litecoinContributorIds : undefined,
          advocates: advocateIds.length > 0 ? advocateIds : undefined,
          hashtags: webflowProject.fieldData.hashtags?.map((tag) => ({ tag })) || [],
        },
      })

      projectIdMap.set(webflowProject.id, project.id)
      console.log(`  ✓ Created project: ${project.name}`)
    } catch (error: any) {
      const name = webflowProject.fieldData.name || webflowProject.slug || 'Unknown'
      console.error(`  ✗ Error creating project "${name}":`, error.message)
      if (error.data) {
        console.error(`    Details:`, JSON.stringify(error.data, null, 2))
      }
    }
  }

  console.log(`✅ Migrated ${projectIdMap.size} projects\n`)
}

async function migrateFAQs(payload: Awaited<ReturnType<typeof getPayload>>) {
  console.log('\n📦 Migrating FAQs...')
  
  const apiToken = process.env.WEBFLOW_API_TOKEN
  const collectionId = process.env.WEBFLOW_COLLECTION_ID_FAQS

  if (!apiToken || !collectionId) {
    console.warn('⚠️  Webflow API credentials not configured for FAQs, skipping...')
    return
  }

  const client = createWebflowClient(apiToken)
  const webflowFAQs = await listCollectionItems<WebflowFAQ>(client, collectionId)

  const activeFAQs = webflowFAQs.filter((f) => !f.isDraft && !f.isArchived)
  console.log(`Found ${activeFAQs.length} active FAQs`)

  let created = 0
  for (const webflowFAQ of activeFAQs) {
    try {
      const projectId = projectIdMap.get(webflowFAQ.fieldData.project || '')
      if (!projectId) {
        console.warn(`  ⚠️  FAQ "${webflowFAQ.fieldData.question || webflowFAQ.fieldData.name}" references unknown project, skipping`)
        continue
      }

      await payload.create({
        collection: 'faqs',
        data: {
          question: webflowFAQ.fieldData.question || webflowFAQ.fieldData.name || 'Untitled FAQ',
          answer: textToLexical(webflowFAQ.fieldData.answer),
          project: projectId,
          order: webflowFAQ.fieldData.order || 0,
          category: webflowFAQ.fieldData.category,
        },
      })

      created++
      console.log(`  ✓ Created FAQ: ${webflowFAQ.fieldData.question || webflowFAQ.fieldData.name}`)
    } catch (error: any) {
      console.error(`  ✗ Error creating FAQ:`, error.message)
    }
  }

  console.log(`✅ Migrated ${created} FAQs\n`)
}

async function migratePosts(payload: Awaited<ReturnType<typeof getPayload>>) {
  console.log('\n📦 Migrating Posts...')
  
  const apiToken = process.env.WEBFLOW_API_TOKEN
  const collectionId = process.env.WEBFLOW_COLLECTION_ID_POSTS

  if (!apiToken || !collectionId) {
    console.warn('⚠️  Webflow API credentials not configured for posts, skipping...')
    return
  }

  const client = createWebflowClient(apiToken)
  const webflowPosts = await listCollectionItems<WebflowPost>(client, collectionId)

  const activePosts = webflowPosts.filter((p) => !p.isDraft && !p.isArchived)
  console.log(`Found ${activePosts.length} active posts`)

  let created = 0
  for (const webflowPost of activePosts) {
    try {
      const projectIds = (webflowPost.fieldData.projects || [])
        .map((id) => projectIdMap.get(id))
        .filter((id): id is number => typeof id === 'number')

      if (projectIds.length === 0) {
        console.warn(`  ⚠️  Post has no valid project references, skipping`)
        continue
      }

      await payload.create({
        collection: 'posts',
        data: {
          xPostLink: webflowPost.fieldData['x-post-link'],
          youtubeLink: webflowPost.fieldData['youtube-link'],
          redditLink: webflowPost.fieldData['reddit-link'],
          projects: projectIds,
        },
      })

      created++
      console.log(`  ✓ Created post`)
    } catch (error: any) {
      console.error(`  ✗ Error creating post:`, error.message)
    }
  }

  console.log(`✅ Migrated ${created} posts\n`)
}

async function migrateUpdates(payload: Awaited<ReturnType<typeof getPayload>>) {
  console.log('\n📦 Migrating Updates...')
  
  const apiToken = process.env.WEBFLOW_API_TOKEN
  const collectionId = process.env.WEBFLOW_COLLECTION_ID_PROJECT_UPDATES

  if (!apiToken || !collectionId) {
    console.warn('⚠️  Webflow API credentials not configured for updates, skipping...')
    return
  }

  const client = createWebflowClient(apiToken)
  const webflowUpdates = await listCollectionItems<WebflowUpdate>(client, collectionId)

  const activeUpdates = webflowUpdates.filter((u) => !u.isDraft && !u.isArchived)
  console.log(`Found ${activeUpdates.length} active updates`)

  let created = 0
  for (const webflowUpdate of activeUpdates) {
    try {
      const projectId = projectIdMap.get(webflowUpdate.fieldData.project || '')
      if (!projectId) {
        console.warn(`  ⚠️  Update "${webflowUpdate.fieldData.title || webflowUpdate.fieldData.name}" references unknown project, skipping`)
        continue
      }

      // Parse date - try to handle various formats
      let updateDate: Date
      const dateStr = webflowUpdate.fieldData.date || webflowUpdate.fieldData.createdOn
      if (dateStr) {
        updateDate = new Date(dateStr)
        if (isNaN(updateDate.getTime())) {
          updateDate = new Date()
        }
      } else {
        updateDate = new Date()
      }

      await payload.create({
        collection: 'updates',
        data: {
          title: webflowUpdate.fieldData.title || webflowUpdate.fieldData.name || 'Untitled Update',
          summary: webflowUpdate.fieldData.summary,
          content: textToLexical(webflowUpdate.fieldData.content),
          project: projectId,
          date: updateDate.toISOString().split('T')[0], // Format as YYYY-MM-DD
          authorTwitterHandle: webflowUpdate.fieldData.authorTwitterHandle,
          tags: webflowUpdate.fieldData.tags?.map((tag) => ({ tag })) || [],
        },
      })

      created++
      console.log(`  ✓ Created update: ${webflowUpdate.fieldData.title || webflowUpdate.fieldData.name}`)
    } catch (error: any) {
      console.error(`  ✗ Error creating update:`, error.message)
    }
  }

  console.log(`✅ Migrated ${created} updates\n`)
}

async function main() {
  console.log('🚀 Starting Webflow to Payload CMS migration...\n')
  console.log(`✓ PAYLOAD_SECRET: ${process.env.PAYLOAD_SECRET ? 'Set' : 'Missing'}`)
  console.log(`✓ DATABASE_URI: ${process.env.DATABASE_URI ? 'Set' : 'Missing'}\n`)

  // Dynamically import config after env vars are loaded
  const { default: config } = await import('../src/payload.config')

  // Initialize Payload
  const payload = await getPayload({ config })

  try {
    // Migrate in order: Contributors -> Projects -> FAQs/Posts/Updates
    await migrateContributors(payload)
    await migrateProjects(payload)
    await migrateFAQs(payload)
    await migratePosts(payload)
    await migrateUpdates(payload)

    console.log('✅ Migration completed successfully!')
    console.log(`\n📊 Summary:`)
    console.log(`   - Contributors: ${contributorIdMap.size}`)
    console.log(`   - Projects: ${projectIdMap.size}`)
  } catch (error) {
    console.error('❌ Migration failed:', error)
    process.exit(1)
  } finally {
    process.exit(0)
  }
}

main()

