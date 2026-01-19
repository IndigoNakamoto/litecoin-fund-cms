/**
 * Refresh script to update existing Payload CMS data from Webflow
 * This script updates existing records instead of skipping them
 * 
 * Usage:
 *   cd payload-cms
 *   npx tsx scripts/refresh-from-webflow.ts
 */

// Load environment variables FIRST
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
dotenv.config({ path: path.resolve(__dirname, '../.env') })

// Verify required environment variables
if (!process.env.PAYLOAD_SECRET) {
  console.error('❌ Error: PAYLOAD_SECRET is not set in .env file')
  process.exit(1)
}

if (!process.env.DATABASE_URI) {
  console.error('❌ Error: DATABASE_URI is not set in .env file')
  process.exit(1)
}

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

// Webflow types (same as migration script)
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

interface WebflowPost {
  id: string
  isDraft: boolean
  isArchived: boolean
  fieldData: {
    link?: string  // Single link field that can be X/Twitter, YouTube, or Reddit
    'x-post-link'?: string  // Legacy field name (may not exist)
    'youtube-link'?: string  // Legacy field name (may not exist)
    'reddit-link'?: string  // Legacy field name (may not exist)
    projects?: string[]
    name?: string
    slug?: string
  }
}

// Map to store Webflow ID -> Payload ID
const contributorIdMap = new Map<string, number>()
const projectIdMap = new Map<string, number>()

// Convert text to Lexical format (same as migration script)
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

async function refreshContributors(payload: Awaited<ReturnType<typeof getPayload>>) {
  console.log('\n🔄 Refreshing Contributors...')
  
  const apiToken = process.env.WEBFLOW_API_TOKEN
  const collectionId = process.env.WEBFLOW_COLLECTION_ID_CONTRIBUTORS

  if (!apiToken || !collectionId) {
    console.warn('⚠️  Webflow API credentials not configured for contributors, skipping...')
    return
  }

  const client = createWebflowClient(apiToken)
  const webflowContributors = await listCollectionItems<WebflowContributor>(client, collectionId)

  const activeContributors = webflowContributors.filter(
    (c) => !c.isDraft && !c.isArchived
  )

  console.log(`Found ${activeContributors.length} active contributors`)

  let updated = 0
  let created = 0

  for (const webflowContributor of activeContributors) {
    try {
      const name = webflowContributor.fieldData.name || 'Unknown Contributor'
      const slug = webflowContributor.fieldData.slug || webflowContributor.slug || webflowContributor.id

      if (!slug || slug.trim().length === 0) {
        console.warn(`  ⚠️  Skipping contributor "${name}" - missing slug`)
        continue
      }

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

      const contributorData = {
        name: name,
        slug: sanitizedSlug,
        twitterLink: webflowContributor.fieldData['twitter-link'],
        discordLink: webflowContributor.fieldData['discord-link'],
        githubLink: webflowContributor.fieldData['github-link'],
        youtubeLink: webflowContributor.fieldData['youtube-link'],
        linkedinLink: webflowContributor.fieldData['linkedin-link'],
        email: webflowContributor.fieldData.email,
        // Note: profilePicture will be handled separately in image migration
      }

      if (existing.docs.length > 0) {
        // Update existing contributor
        await payload.update({
          collection: 'contributors',
          id: existing.docs[0].id,
          data: contributorData,
        })
        contributorIdMap.set(webflowContributor.id, existing.docs[0].id)
        updated++
        console.log(`  ✓ Updated contributor: ${name}`)
      } else {
        // Check for legacy slug (Webflow ID)
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
          const updatedContributor = await payload.update({
            collection: 'contributors',
            id: legacy.docs[0].id,
            data: contributorData,
          })
          contributorIdMap.set(webflowContributor.id, updatedContributor.id)
          updated++
          console.log(`  ✓ Updated contributor slug: ${name} -> ${sanitizedSlug}`)
        } else {
          // Create new contributor
          const contributor = await payload.create({
            collection: 'contributors',
            data: contributorData,
          })
          contributorIdMap.set(webflowContributor.id, contributor.id)
          created++
          console.log(`  ✓ Created contributor: ${name}`)
        }
      }
    } catch (error: any) {
      const name = webflowContributor.fieldData.name || webflowContributor.slug || 'Unknown'
      console.error(`  ✗ Error processing contributor "${name}":`, error.message)
    }
  }

  console.log(`✅ Refreshed contributors: ${updated} updated, ${created} created\n`)
}

async function refreshProjects(payload: Awaited<ReturnType<typeof getPayload>>) {
  console.log('\n🔄 Refreshing Projects...')
  
  const apiToken = process.env.WEBFLOW_API_TOKEN
  const collectionId = process.env.WEBFLOW_COLLECTION_ID_PROJECTS

  if (!apiToken || !collectionId) {
    console.warn('⚠️  Webflow API credentials not configured for projects, skipping...')
    return
  }

  const client = createWebflowClient(apiToken)
  const webflowProjects = await listCollectionItems<WebflowProject>(client, collectionId)

  const publishedProjects = webflowProjects.filter(
    (p) => !p.isDraft && !p.isArchived && !p.fieldData.hidden
  )

  console.log(`Found ${publishedProjects.length} published projects`)

  const projectTypeMap: Record<string, 'open-source' | 'research' | 'education' | 'infrastructure'> = {
    'open-source': 'open-source',
    'opensource': 'open-source',
    'open source': 'open-source',
    'research': 'research',
    'education': 'education',
    'infrastructure': 'infrastructure',
    'infra': 'infrastructure',
  }

  let updated = 0
  let created = 0

  for (const webflowProject of publishedProjects) {
    try {
      const name = webflowProject.fieldData.name || 'Unknown Project'
      const slug = webflowProject.fieldData.slug || webflowProject.slug || webflowProject.id

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

      // Map status
      let status = (webflowProject.fieldData.status || '').toLowerCase()
      if (!['active', 'completed', 'paused', 'archived'].includes(status)) {
        if (status.includes('active') || status.includes('live')) status = 'active'
        else if (status.includes('complete') || status.includes('done')) status = 'completed'
        else if (status.includes('pause') || status.includes('hold')) status = 'paused'
        else if (status.includes('archive')) status = 'archived'
        else status = 'active'
      }

      // Map project type
      let projectType: 'open-source' | 'research' | 'education' | 'infrastructure' | undefined
      const webflowProjectType = (webflowProject.fieldData['project-type'] || '').toLowerCase().trim()
      if (webflowProjectType) {
        projectType = projectTypeMap[webflowProjectType] || undefined
      }

      const projectData = {
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
        // Note: coverImage will be handled separately in image migration
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
        // Update existing project
        await payload.update({
          collection: 'projects',
          id: existing.docs[0].id,
          data: projectData,
        })
        projectIdMap.set(webflowProject.id, existing.docs[0].id)
        updated++
        console.log(`  ✓ Updated project: ${name}`)
      } else {
        // Check for legacy slug
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
          const updatedProject = await payload.update({
            collection: 'projects',
            id: legacy.docs[0].id,
            data: projectData,
          })
          projectIdMap.set(webflowProject.id, updatedProject.id)
          updated++
          console.log(`  ✓ Updated project slug: ${name} -> ${sanitizedSlug}`)
        } else {
          // Create new project
          const project = await payload.create({
            collection: 'projects',
            data: projectData,
          })
          projectIdMap.set(webflowProject.id, project.id)
          created++
          console.log(`  ✓ Created project: ${name}`)
        }
      }
    } catch (error: any) {
      const name = webflowProject.fieldData.name || webflowProject.slug || 'Unknown'
      console.error(`  ✗ Error processing project "${name}":`, error.message)
    }
  }

  console.log(`✅ Refreshed projects: ${updated} updated, ${created} created\n`)
}

async function refreshPosts(payload: Awaited<ReturnType<typeof getPayload>>) {
  console.log('\n🔄 Refreshing Posts...')
  
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

  let updated = 0
  let created = 0
  let skipped = 0

  for (const webflowPost of activePosts) {
    try {
      const projectIds = (webflowPost.fieldData.projects || [])
        .map((id) => projectIdMap.get(id))
        .filter((id): id is number => typeof id === 'number')

      if (projectIds.length === 0) {
        console.warn(`  ⚠️  Post ${webflowPost.id} has no valid project references, skipping`)
        skipped++
        continue
      }

      // Webflow uses a single "link" field that can contain X/Twitter, YouTube, or Reddit URLs
      // Determine link type and map to appropriate field
      const link = webflowPost.fieldData.link || 
                   webflowPost.fieldData['x-post-link'] || 
                   webflowPost.fieldData['youtube-link'] || 
                   webflowPost.fieldData['reddit-link']

      let xPostLink: string | null = null
      let youtubeLink: string | null = null
      let redditLink: string | null = null

      if (link) {
        const lowerLink = link.toLowerCase()
        if (lowerLink.includes('x.com') || lowerLink.includes('twitter.com')) {
          xPostLink = link
        } else if (lowerLink.includes('youtube.com') || lowerLink.includes('youtu.be')) {
          youtubeLink = link
        } else if (lowerLink.includes('reddit.com')) {
          redditLink = link
        }
        // If link doesn't match known patterns, try to determine from existing separate fields
        if (!xPostLink && !youtubeLink && !redditLink) {
          // If we have legacy separate fields, use those
          xPostLink = webflowPost.fieldData['x-post-link'] || null
          youtubeLink = webflowPost.fieldData['youtube-link'] || null
          redditLink = webflowPost.fieldData['reddit-link'] || null
          // If we still have a link but didn't match, default to xPostLink (most common)
          if (link && !xPostLink && !youtubeLink && !redditLink) {
            xPostLink = link
          }
        }
      } else {
        // Fallback to legacy separate fields if no single link field
        xPostLink = webflowPost.fieldData['x-post-link'] || null
        youtubeLink = webflowPost.fieldData['youtube-link'] || null
        redditLink = webflowPost.fieldData['reddit-link'] || null
      }

      // Check if at least one link exists
      const hasAnyLink = xPostLink || youtubeLink || redditLink

      // Find existing post by matching link URL first (most reliable)
      // If that fails, try matching by projects
      let matchingPost = null
      
      if (hasAnyLink) {
        // Try to find post by link URL
        const linkToMatch = xPostLink || youtubeLink || redditLink
        if (linkToMatch) {
          const postsByLink = await payload.find({
            collection: 'posts',
            where: {
              or: [
                ...(xPostLink ? [{ xPostLink: { equals: xPostLink } }] : []),
                ...(youtubeLink ? [{ youtubeLink: { equals: youtubeLink } }] : []),
                ...(redditLink ? [{ redditLink: { equals: redditLink } }] : []),
              ],
            },
            limit: 10,
          })
          
          if (postsByLink.docs.length > 0) {
            matchingPost = postsByLink.docs[0]
          }
        }
      }
      
      // If not found by link, don't match by projects alone
      // Multiple posts can share the same projects, so we should create a new post
      // unless we have a unique link to match on

      const postData = {
        xPostLink,
        youtubeLink,
        redditLink,
        projects: projectIds,
      }

      const postName = webflowPost.fieldData.name || webflowPost.id
      
      if (matchingPost) {
        // Check if link already exists and is the same
        const existingLink = matchingPost.xPostLink || matchingPost.youtubeLink || matchingPost.redditLink
        const newLink = xPostLink || youtubeLink || redditLink
        
        if (existingLink === newLink && hasAnyLink) {
          // Link already exists and matches, skip
          console.log(`  ⊘ Skipped post "${postName.substring(0, 50)}..." - link already exists`)
          skipped++
        } else {
          // Update existing post
          await payload.update({
            collection: 'posts',
            id: matchingPost.id,
            data: postData,
          })
          updated++
          if (hasAnyLink) {
            console.log(`  ✓ Updated post ${matchingPost.id} "${postName.substring(0, 40)}..." with link`)
          } else {
            console.log(`  ⚠️  Updated post ${matchingPost.id} "${postName.substring(0, 40)}..." but still no links`)
          }
        }
      } else {
        // Create new post
        try {
          const newPost = await payload.create({
            collection: 'posts',
            data: postData,
          })
          created++
          if (hasAnyLink) {
            console.log(`  ✓ Created post ${newPost.id} "${postName.substring(0, 40)}..." with link`)
          } else {
            console.log(`  ⚠️  Created post ${newPost.id} "${postName.substring(0, 40)}..." but no links found`)
          }
        } catch (error: any) {
          console.error(`  ✗ Error creating post "${postName.substring(0, 40)}...":`, error.message)
        }
      }
    } catch (error: any) {
      console.error(`  ✗ Error processing post:`, error.message)
    }
  }

  console.log(`✅ Refreshed posts: ${updated} updated, ${created} created, ${skipped} skipped\n`)
}

async function main() {
  console.log('🚀 Starting Webflow to Payload CMS refresh...\n')
  console.log(`✓ PAYLOAD_SECRET: ${process.env.PAYLOAD_SECRET ? 'Set' : 'Missing'}`)
  console.log(`✓ DATABASE_URI: ${process.env.DATABASE_URI ? 'Set' : 'Missing'}\n`)

  // Verify secret is not empty
  if (!process.env.PAYLOAD_SECRET || process.env.PAYLOAD_SECRET.trim() === '') {
    console.error('❌ Error: PAYLOAD_SECRET is empty or not set')
    process.exit(1)
  }

  // Dynamically import config after env vars are loaded
  const { default: config } = await import('../src/payload.config.js')

  // Initialize Payload
  const payload = await getPayload({ config })

  try {
    // Refresh in order: Contributors -> Projects -> Posts
    await refreshContributors(payload)
    await refreshProjects(payload)
    await refreshPosts(payload)

    console.log('✅ Refresh completed successfully!')
    console.log(`\n📊 Summary:`)
    console.log(`   - Contributors mapped: ${contributorIdMap.size}`)
    console.log(`   - Projects mapped: ${projectIdMap.size}`)
  } catch (error) {
    console.error('❌ Refresh failed:', error)
    process.exit(1)
  } finally {
    process.exit(0)
  }
}

main()
