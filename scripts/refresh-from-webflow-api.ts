/**
 * Refresh script to update existing Payload CMS data from Webflow via API
 * This script updates existing records instead of skipping them
 * 
 * Usage:
 *   cd payload-cms
 *   npx tsx scripts/refresh-from-webflow-api.ts
 */

import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'
import axios from 'axios'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
dotenv.config({ path: path.resolve(__dirname, '../.env') })

const PAYLOAD_API_URL = process.env.PAYLOAD_API_URL || 'http://localhost:3001/api'
const PAYLOAD_API_TOKEN = process.env.PAYLOAD_API_TOKEN

const payloadClient = axios.create({
  baseURL: PAYLOAD_API_URL,
  headers: {
    'Content-Type': 'application/json',
    ...(PAYLOAD_API_TOKEN && { Authorization: `Bearer ${PAYLOAD_API_TOKEN}` }),
  },
})

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

// Fetch all items from Payload
async function listPayloadItems(collectionSlug: string): Promise<any[]> {
  const allItems: any[] = []
  let page = 1
  const limit = 100

  while (true) {
    try {
      const response = await payloadClient.get(`/${collectionSlug}`, {
        params: {
          page,
          limit,
          depth: 1,
        },
      })

      const { docs } = response.data
      allItems.push(...docs)

      if (docs.length < limit || page >= (response.data.totalPages || 1)) {
        break
      }

      page++
    } catch (error: any) {
      if (error.response?.status === 404) {
        return []
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
    'bitcoin-contributors-2'?: string[]
    'litecoin-contributors'?: string[]
    'litecoin-contributors-2'?: string[]
    advocates?: string[]
    'advocates-2'?: string[]
    hashtags?: string[]
  }
}

// Map to store Webflow ID -> Payload ID
const contributorIdMap = new Map<string, number>()
const projectIdMap = new Map<string, number>()

// Convert text to Lexical format
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

async function refreshContributors() {
  console.log('\n🔄 Refreshing Contributors...')
  
  const apiToken = process.env.WEBFLOW_API_TOKEN
  const contributorsCollectionId = process.env.WEBFLOW_COLLECTION_ID_CONTRIBUTORS
  const projectsCollectionId = process.env.WEBFLOW_COLLECTION_ID_PROJECTS

  if (!apiToken || !contributorsCollectionId) {
    console.warn('⚠️  Webflow API credentials not configured for contributors, skipping...')
    return
  }

  const client = createWebflowClient(apiToken)
  
  // Get all contributors (including archived/draft) to check which are referenced
  const allWebflowContributors = await listCollectionItems<WebflowContributor>(client, contributorsCollectionId)
  console.log(`Found ${allWebflowContributors.length} total contributors in Webflow`)

  // Find contributors referenced in projects (even if archived/draft)
  const contributorsToMigrate = new Set<string>()
  if (projectsCollectionId) {
    try {
      const webflowProjects = await listCollectionItems<WebflowProject>(client, projectsCollectionId)
      for (const project of webflowProjects) {
        const allContributorIds = [
          ...(project.fieldData['bitcoin-contributors'] || []),
          ...(project.fieldData['bitcoin-contributors-2'] || []),
          ...(project.fieldData['litecoin-contributors'] || []),
          ...(project.fieldData['litecoin-contributors-2'] || []),
          ...(project.fieldData.advocates || []),
          ...(project.fieldData['advocates-2'] || []),
        ]
        allContributorIds.forEach((id) => contributorsToMigrate.add(id))
      }
      console.log(`Found ${contributorsToMigrate.size} contributors referenced in projects`)
    } catch (error: any) {
      console.warn('⚠️  Could not fetch projects to check referenced contributors:', error.message)
    }
  }

  // Include ALL non-archived contributors (active + drafts)
  // This matches what Webflow shows on the /projects page ("Project Builders")
  // We only exclude archived contributors since those are truly hidden
  const contributorsToProcess = allWebflowContributors.filter(
    (c) => !c.isArchived || contributorsToMigrate.has(c.id)
  )

  const activeCount = contributorsToProcess.filter((c) => !c.isDraft && !c.isArchived).length
  const archivedCount = contributorsToProcess.filter((c) => c.isArchived).length
  const draftCount = contributorsToProcess.filter((c) => c.isDraft && !c.isArchived).length

  console.log(`Processing ${contributorsToProcess.length} contributors:`)
  console.log(`  - Active: ${activeCount}`)
  console.log(`  - Drafts: ${draftCount}`)
  if (archivedCount > 0) console.log(`  - Archived (referenced): ${archivedCount}`)

  // Get existing Payload contributors
  const payloadContributors = await listPayloadItems('contributors')
  // Create multiple lookup maps for better matching
  const payloadContributorsBySlug = new Map(
    payloadContributors.map((c) => [c.slug?.toLowerCase().trim() || '', c])
  )
  const payloadContributorsByName = new Map(
    payloadContributors
      .filter((c) => c.name)
      .map((c) => [c.name.toLowerCase().trim(), c])
  )

  console.log(`Found ${payloadContributors.length} existing contributors in Payload`)

  let updated = 0
  let created = 0
  let skipped = 0

  for (const webflowContributor of contributorsToProcess) {
    try {
      const name = webflowContributor.fieldData.name || 'Unknown Contributor'
      const rawSlug = webflowContributor.fieldData.slug || webflowContributor.slug || webflowContributor.id

      if (!rawSlug || rawSlug.trim().length === 0) {
        console.warn(`  ⚠️  Skipping contributor "${name}" - missing slug`)
        skipped++
        continue
      }

      const sanitizedSlug = rawSlug
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')

      if (!sanitizedSlug || sanitizedSlug.length === 0) {
        console.warn(`  ⚠️  Skipping contributor "${name}" - invalid slug after sanitization`)
        skipped++
        continue
      }

      const contributorData = {
        name: name,
        slug: sanitizedSlug,
        twitterLink: webflowContributor.fieldData['twitter-link'],
        discordLink: webflowContributor.fieldData['discord-link'],
        githubLink: webflowContributor.fieldData['github-link'],
        youtubeLink: webflowContributor.fieldData['youtube-link'],
        linkedinLink: webflowContributor.fieldData['linkedin-link'],
        email: webflowContributor.fieldData.email,
      }

      // Try multiple matching strategies
      let existing = payloadContributorsBySlug.get(sanitizedSlug)
      
      // If not found by slug, try by name
      if (!existing && name && name !== 'Unknown Contributor') {
        existing = payloadContributorsByName.get(name.toLowerCase().trim())
      }

      // If still not found, try original slug variations
      if (!existing) {
        const originalSlug = (webflowContributor.fieldData.slug || webflowContributor.slug || '')
          .toLowerCase()
          .trim()
        if (originalSlug) {
          existing = payloadContributorsBySlug.get(originalSlug)
        }
      }

      if (existing) {
        // Update existing contributor
        await payloadClient.patch(`/contributors/${existing.id}`, contributorData)
        contributorIdMap.set(webflowContributor.id, existing.id)
        updated++
        const status = webflowContributor.isArchived ? ' (archived)' : webflowContributor.isDraft ? ' (draft)' : ''
        console.log(`  ✓ Updated contributor: ${name}${status}`)
      } else {
        // Create new contributor
        const response = await payloadClient.post('/contributors', contributorData)
        contributorIdMap.set(webflowContributor.id, response.data.id)
        created++
        const status = webflowContributor.isArchived ? ' (archived)' : webflowContributor.isDraft ? ' (draft)' : ''
        console.log(`  ✓ Created contributor: ${name}${status}`)
      }
    } catch (error: any) {
      const name = webflowContributor.fieldData.name || webflowContributor.slug || 'Unknown'
      console.error(`  ✗ Error processing contributor "${name}":`, error.message)
      if (error.response?.data) {
        console.error(`    Details:`, JSON.stringify(error.response.data, null, 2))
      }
      skipped++
    }
  }

  console.log(`✅ Refreshed contributors: ${updated} updated, ${created} created, ${skipped} skipped\n`)
}

async function refreshProjects() {
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

  console.log(`Found ${publishedProjects.length} published projects in Webflow`)

  // Get existing Payload projects
  const payloadProjects = await listPayloadItems('projects')
  const payloadProjectsBySlug = new Map(payloadProjects.map((p) => [p.slug, p]))

  console.log(`Found ${payloadProjects.length} existing projects in Payload`)

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

      // Map contributor IDs (try both field name variations for compatibility)
      const bitcoinContributorIds = [
        ...(webflowProject.fieldData['bitcoin-contributors-2'] || []),
        ...(webflowProject.fieldData['bitcoin-contributors'] || []),
      ]
        .map((id) => contributorIdMap.get(id))
        .filter((id): id is number => typeof id === 'number')

      const litecoinContributorIds = [
        ...(webflowProject.fieldData['litecoin-contributors-2'] || []),
        ...(webflowProject.fieldData['litecoin-contributors'] || []),
      ]
        .map((id) => contributorIdMap.get(id))
        .filter((id): id is number => typeof id === 'number')

      const advocateIds = [
        ...(webflowProject.fieldData['advocates-2'] || []),
        ...(webflowProject.fieldData.advocates || []),
      ]
        .map((id) => contributorIdMap.get(id))
        .filter((id): id is number => typeof id === 'number')

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
      }

      const existing = payloadProjectsBySlug.get(sanitizedSlug) || 
                       payloadProjectsBySlug.get(webflowProject.id)

      if (existing) {
        // Update existing project
        await payloadClient.patch(`/projects/${existing.id}`, projectData)
        projectIdMap.set(webflowProject.id, existing.id)
        updated++
        console.log(`  ✓ Updated project: ${name}`)
      } else {
        // Create new project
        const response = await payloadClient.post('/projects', projectData)
        projectIdMap.set(webflowProject.id, response.data.id)
        created++
        console.log(`  ✓ Created project: ${name}`)
      }
    } catch (error: any) {
      const name = webflowProject.fieldData.name || webflowProject.slug || 'Unknown'
      console.error(`  ✗ Error processing project "${name}":`, error.message)
      if (error.response?.data) {
        console.error(`    Details:`, JSON.stringify(error.response.data, null, 2))
      }
    }
  }

  console.log(`✅ Refreshed projects: ${updated} updated, ${created} created\n`)
}

async function main() {
  console.log('🚀 Starting Webflow to Payload CMS refresh via API...\n')
  console.log(`API URL: ${PAYLOAD_API_URL}\n`)

  try {
    // Refresh in order: Contributors -> Projects
    await refreshContributors()
    await refreshProjects()

    console.log('✅ Refresh completed successfully!')
    console.log(`\n📊 Summary:`)
    console.log(`   - Contributors mapped: ${contributorIdMap.size}`)
    console.log(`   - Projects mapped: ${projectIdMap.size}`)
  } catch (error: any) {
    console.error('❌ Refresh failed:', error.message)
    if (error.response) {
      console.error('   Response:', error.response.status, error.response.statusText)
      console.error('   Data:', JSON.stringify(error.response.data, null, 2))
    }
    process.exit(1)
  }
}

main()
