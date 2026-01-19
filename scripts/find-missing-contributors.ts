/**
 * Diagnostic script to find contributors in Webflow that are missing from Payload
 * 
 * Usage:
 *   cd payload-cms
 *   npx tsx scripts/find-missing-contributors.ts
 */

import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'
import axios from 'axios'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
dotenv.config({ path: path.resolve(__dirname, '../.env') })

const PAYLOAD_API_URL = process.env.PAYLOAD_API_URL || 'http://localhost:3001/api'
const PAYFLOW_API_TOKEN = process.env.WEBFLOW_API_TOKEN

const payloadClient = axios.create({
  baseURL: PAYLOAD_API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
})

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

interface WebflowContributor {
  id: string
  slug: string
  isDraft: boolean
  isArchived: boolean
  fieldData: {
    name?: string
    slug?: string
  }
}

interface WebflowProject {
  id: string
  fieldData: {
    name: string
    'bitcoin-contributors'?: string[]
    'bitcoin-contributors-2'?: string[]
    'litecoin-contributors'?: string[]
    'litecoin-contributors-2'?: string[]
    advocates?: string[]
    'advocates-2'?: string[]
  }
}

async function main() {
  console.log('🔍 Finding missing contributors...\n')

  if (!PAYFLOW_API_TOKEN) {
    console.error('❌ WEBFLOW_API_TOKEN not configured')
    process.exit(1)
  }

  const contributorsCollectionId = process.env.WEBFLOW_COLLECTION_ID_CONTRIBUTORS
  const projectsCollectionId = process.env.WEBFLOW_COLLECTION_ID_PROJECTS

  if (!contributorsCollectionId || !projectsCollectionId) {
    console.error('❌ Webflow collection IDs not configured')
    process.exit(1)
  }

  const client = createWebflowClient(PAYFLOW_API_TOKEN)

  // Get all Webflow contributors (including archived/draft)
  console.log('📥 Fetching all contributors from Webflow...')
  const webflowContributors = await listCollectionItems<WebflowContributor>(
    client,
    contributorsCollectionId
  )
  console.log(`   Found ${webflowContributors.length} total contributors in Webflow`)

  const activeContributors = webflowContributors.filter((c) => !c.isDraft && !c.isArchived)
  const archivedContributors = webflowContributors.filter((c) => c.isArchived)
  const draftContributors = webflowContributors.filter((c) => c.isDraft && !c.isArchived)

  console.log(`   - Active: ${activeContributors.length}`)
  console.log(`   - Archived: ${archivedContributors.length}`)
  console.log(`   - Draft: ${draftContributors.length}`)

  // Get all Payload contributors
  console.log('\n📥 Fetching all contributors from Payload...')
  const payloadContributors = await listPayloadItems('contributors')
  console.log(`   Found ${payloadContributors.length} contributors in Payload`)

  // Build maps for comparison
  const webflowContributorsBySlug = new Map(
    webflowContributors.map((c) => [
      (c.fieldData.slug || c.slug || c.id).toLowerCase().trim(),
      c,
    ])
  )
  const webflowContributorsById = new Map(webflowContributors.map((c) => [c.id, c]))

  const payloadContributorsBySlug = new Map(
    payloadContributors.map((c) => [c.slug?.toLowerCase().trim() || '', c])
  )

  // Find contributors referenced in projects
  console.log('\n📥 Fetching projects from Webflow to find referenced contributors...')
  const webflowProjects = await listCollectionItems<WebflowProject>(
    client,
    projectsCollectionId
  )
  
  const referencedContributorIds = new Set<string>()
  for (const project of webflowProjects) {
    const allContributorIds = [
      ...(project.fieldData['bitcoin-contributors'] || []),
      ...(project.fieldData['bitcoin-contributors-2'] || []),
      ...(project.fieldData['litecoin-contributors'] || []),
      ...(project.fieldData['litecoin-contributors-2'] || []),
      ...(project.fieldData.advocates || []),
      ...(project.fieldData['advocates-2'] || []),
    ]
    allContributorIds.forEach((id) => referencedContributorIds.add(id))
  }
  
  console.log(`   Found ${referencedContributorIds.size} unique contributors referenced in projects`)

  // Find missing contributors
  const missingActive: WebflowContributor[] = []
  const missingArchived: WebflowContributor[] = []
  const missingDraft: WebflowContributor[] = []
  const referencedButMissing: WebflowContributor[] = []

  for (const webflowContributor of webflowContributors) {
    const slug = (webflowContributor.fieldData.slug || webflowContributor.slug || webflowContributor.id)
      .toLowerCase()
      .trim()
    const inPayload = payloadContributorsBySlug.has(slug)

    if (!inPayload) {
      if (webflowContributor.isArchived) {
        missingArchived.push(webflowContributor)
      } else if (webflowContributor.isDraft) {
        missingDraft.push(webflowContributor)
      } else {
        missingActive.push(webflowContributor)
      }

      // Check if this contributor is referenced in any project
      if (referencedContributorIds.has(webflowContributor.id)) {
        referencedButMissing.push(webflowContributor)
      }
    }
  }

  // Report results
  console.log('\n📊 Missing Contributors Summary:')
  console.log(`   - Active contributors missing: ${missingActive.length}`)
  console.log(`   - Archived contributors missing: ${missingArchived.length}`)
  console.log(`   - Draft contributors missing: ${missingDraft.length}`)
  console.log(`   - Referenced in projects but missing: ${referencedButMissing.length}`)

  if (missingActive.length > 0) {
    console.log('\n❌ Missing Active Contributors:')
    missingActive.forEach((c, i) => {
      const name = c.fieldData.name || 'Unknown'
      const slug = c.fieldData.slug || c.slug || c.id
      const isReferenced = referencedContributorIds.has(c.id) ? ' ⚠️  REFERENCED' : ''
      console.log(`   ${i + 1}. ${name} (${slug})${isReferenced}`)
    })
  }

  if (referencedButMissing.length > 0) {
    console.log('\n⚠️  Contributors Referenced in Projects but Missing from Payload:')
    referencedButMissing.forEach((c, i) => {
      const name = c.fieldData.name || 'Unknown'
      const slug = c.fieldData.slug || c.slug || c.id
      const status = c.isArchived ? 'ARCHIVED' : c.isDraft ? 'DRAFT' : 'ACTIVE'
      console.log(`   ${i + 1}. ${name} (${slug}) - ${status}`)
    })
  }

  if (missingArchived.length > 0 && missingArchived.length <= 20) {
    console.log('\n📦 Missing Archived Contributors (not migrated):')
    missingArchived.slice(0, 20).forEach((c, i) => {
      const name = c.fieldData.name || 'Unknown'
      const slug = c.fieldData.slug || c.slug || c.id
      console.log(`   ${i + 1}. ${name} (${slug})`)
    })
    if (missingArchived.length > 20) {
      console.log(`   ... and ${missingArchived.length - 20} more`)
    }
  }

  // Check for contributors in Payload that don't exist in Webflow
  const orphanedContributors = payloadContributors.filter((p) => {
    const slug = p.slug?.toLowerCase().trim() || ''
    return !webflowContributorsBySlug.has(slug)
  })

  if (orphanedContributors.length > 0) {
    console.log(`\n⚠️  Contributors in Payload but not in Webflow: ${orphanedContributors.length}`)
    orphanedContributors.slice(0, 10).forEach((c, i) => {
      console.log(`   ${i + 1}. ${c.name} (${c.slug})`)
    })
    if (orphanedContributors.length > 10) {
      console.log(`   ... and ${orphanedContributors.length - 10} more`)
    }
  }

  console.log('\n✅ Analysis complete!')
}

main().catch((error) => {
  console.error('❌ Error:', error.message)
  if (error.response) {
    console.error('   Response:', error.response.status, error.response.statusText)
    console.error('   Data:', JSON.stringify(error.response.data, null, 2))
  }
  process.exit(1)
})
