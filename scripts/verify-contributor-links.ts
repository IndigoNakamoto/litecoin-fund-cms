/**
 * Verify contributor-project relationships are properly linked
 * 
 * Usage:
 *   cd litecoin-fund-cms
 *   npx tsx scripts/verify-contributor-links.ts
 */

import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'
import axios from 'axios'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
dotenv.config({ path: path.resolve(__dirname, '../.env') })

const PAYLOAD_API_URL = process.env.PAYLOAD_API_URL || 'http://localhost:3001/api'
const WEBFLOW_API_TOKEN = process.env.WEBFLOW_API_TOKEN

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

async function listPayloadItems(collectionSlug: string, depth = 2): Promise<any[]> {
  const allItems: any[] = []
  let page = 1
  const limit = 100

  while (true) {
    try {
      const response = await payloadClient.get(`/${collectionSlug}`, {
        params: {
          page,
          limit,
          depth,
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
  console.log('🔍 Verifying contributor-project relationships...\n')

  if (!WEBFLOW_API_TOKEN) {
    console.error('❌ WEBFLOW_API_TOKEN not configured')
    process.exit(1)
  }

  const contributorsCollectionId = process.env.WEBFLOW_COLLECTION_ID_CONTRIBUTORS
  const projectsCollectionId = process.env.WEBFLOW_COLLECTION_ID_PROJECTS

  if (!contributorsCollectionId || !projectsCollectionId) {
    console.error('❌ Webflow collection IDs not configured')
    process.exit(1)
  }

  const client = createWebflowClient(WEBFLOW_API_TOKEN)

  // Get Webflow data
  console.log('📥 Fetching data from Webflow...')
  const webflowContributors = await listCollectionItems<WebflowContributor>(
    client,
    contributorsCollectionId
  )
  const activeWebflowContributors = webflowContributors.filter((c) => !c.isDraft && !c.isArchived)
  const webflowContributorsById = new Map(activeWebflowContributors.map((c) => [c.id, c]))

  const webflowProjects = await listCollectionItems<WebflowProject>(
    client,
    projectsCollectionId
  )
  const publishedWebflowProjects = webflowProjects.filter(
    (p) => !p.isDraft && !p.isArchived && !p.fieldData.hidden
  )

  console.log(`   Found ${activeWebflowContributors.length} active contributors in Webflow`)
  console.log(`   Found ${publishedWebflowProjects.length} published projects in Webflow`)

  // Get Payload data
  console.log('\n📥 Fetching data from Payload...')
  const payloadContributors = await listPayloadItems('contributors')
  const payloadContributorsById = new Map(payloadContributors.map((c) => [c.id.toString(), c]))
  const payloadContributorsBySlug = new Map(
    payloadContributors.map((c) => [c.slug?.toLowerCase().trim() || '', c])
  )

  const payloadProjects = await listPayloadItems('projects', 2)
  const payloadProjectsBySlug = new Map(payloadProjects.map((p) => [p.slug, p]))

  console.log(`   Found ${payloadContributors.length} contributors in Payload`)
  console.log(`   Found ${payloadProjects.length} projects in Payload`)

  // Build mapping from Webflow ID to Payload ID
  const webflowToPayloadIdMap = new Map<string, number>()
  for (const webflowContributor of activeWebflowContributors) {
    const slug = (webflowContributor.fieldData.slug || webflowContributor.slug || webflowContributor.id)
      .toLowerCase()
      .trim()
    const payloadContributor = payloadContributorsBySlug.get(slug)
    if (payloadContributor) {
      webflowToPayloadIdMap.set(webflowContributor.id, payloadContributor.id)
    }
  }

  console.log(`\n📊 Mapped ${webflowToPayloadIdMap.size} contributor IDs from Webflow to Payload`)

  // Check Webflow projects for contributors
  const issues: Array<{
    type: string
    project: string
    field: string
    webflowContributorId?: string
    message: string
  }> = []

  let totalWebflowReferences = 0
  let totalWebflowReferencesFound = 0

  for (const webflowProject of publishedWebflowProjects) {
    const projectName = webflowProject.fieldData.name
    const allContributorIds = [
      ...(webflowProject.fieldData['bitcoin-contributors'] || []),
      ...(webflowProject.fieldData['bitcoin-contributors-2'] || []),
      ...(webflowProject.fieldData['litecoin-contributors'] || []),
      ...(webflowProject.fieldData['litecoin-contributors-2'] || []),
      ...(webflowProject.fieldData.advocates || []),
      ...(webflowProject.fieldData['advocates-2'] || []),
    ]

    for (const contributorId of allContributorIds) {
      totalWebflowReferences++
      const webflowContributor = webflowContributorsById.get(contributorId)
      
      if (!webflowContributor) {
        issues.push({
          type: 'missing-in-webflow',
          project: projectName,
          field: 'contributors',
          webflowContributorId: contributorId,
          message: `Contributor ID ${contributorId} not found in Webflow active contributors`,
        })
        continue
      }

      const payloadId = webflowToPayloadIdMap.get(contributorId)
      if (!payloadId) {
        issues.push({
          type: 'not-migrated',
          project: projectName,
          field: 'contributors',
          webflowContributorId: contributorId,
          message: `Contributor "${webflowContributor.fieldData.name || contributorId}" not found in Payload`,
        })
        continue
      }

      totalWebflowReferencesFound++
    }
  }

  // Check Payload projects for contributors
  let totalPayloadReferences = 0
  let totalPayloadReferencesValid = 0

  for (const payloadProject of payloadProjects) {
    const allContributors = [
      ...(payloadProject.bitcoinContributors || []),
      ...(payloadProject.litecoinContributors || []),
      ...(payloadProject.advocates || []),
    ]

    for (const contributor of allContributors) {
      totalPayloadReferences++
      const contributorId = typeof contributor === 'object' ? contributor.id : contributor
      if (payloadContributorsById.has(contributorId.toString())) {
        totalPayloadReferencesValid++
      } else {
        issues.push({
          type: 'broken-link',
          project: payloadProject.name,
          field: 'contributors',
          message: `Contributor ID ${contributorId} linked in Payload but contributor doesn't exist`,
        })
      }
    }
  }

  // Report results
  console.log('\n📊 Relationship Analysis:\n')
  console.log('Webflow Projects:')
  console.log(`   - Total contributor references: ${totalWebflowReferences}`)
  console.log(`   - Found in Payload: ${totalWebflowReferencesFound}`)
  console.log(`   - Missing from Payload: ${totalWebflowReferences - totalWebflowReferencesFound}`)

  console.log('\nPayload Projects:')
  console.log(`   - Total contributor references: ${totalPayloadReferences}`)
  console.log(`   - Valid references: ${totalPayloadReferencesValid}`)
  console.log(`   - Broken references: ${totalPayloadReferences - totalPayloadReferencesValid}`)

  if (issues.length > 0) {
    console.log(`\n⚠️  Found ${issues.length} issues:\n`)
    
    const notMigrated = issues.filter((i) => i.type === 'not-migrated')
    const brokenLinks = issues.filter((i) => i.type === 'broken-link')
    const missingInWebflow = issues.filter((i) => i.type === 'missing-in-webflow')

    if (notMigrated.length > 0) {
      console.log(`❌ Contributors not migrated (${notMigrated.length}):`)
      notMigrated.slice(0, 10).forEach((issue, i) => {
        console.log(`   ${i + 1}. ${issue.project}: ${issue.message}`)
      })
      if (notMigrated.length > 10) {
        console.log(`   ... and ${notMigrated.length - 10} more`)
      }
    }

    if (brokenLinks.length > 0) {
      console.log(`\n🔗 Broken links in Payload (${brokenLinks.length}):`)
      brokenLinks.slice(0, 10).forEach((issue, i) => {
        console.log(`   ${i + 1}. ${issue.project}: ${issue.message}`)
      })
      if (brokenLinks.length > 10) {
        console.log(`   ... and ${brokenLinks.length - 10} more`)
      }
    }

    if (missingInWebflow.length > 0) {
      console.log(`\n⚠️  Missing in Webflow (${missingInWebflow.length}):`)
      missingInWebflow.slice(0, 10).forEach((issue, i) => {
        console.log(`   ${i + 1}. ${issue.project}: ${issue.message}`)
      })
      if (missingInWebflow.length > 10) {
        console.log(`   ... and ${missingInWebflow.length - 10} more`)
      }
    }
  } else {
    console.log('\n✅ All contributor-project relationships are properly linked!')
  }

  console.log('\n✅ Verification complete!')
}

main().catch((error) => {
  console.error('❌ Error:', error.message)
  if (error.response) {
    console.error('   Response:', error.response.status, error.response.statusText)
    console.error('   Data:', JSON.stringify(error.response.data, null, 2))
  }
  process.exit(1)
})
