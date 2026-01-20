/**
 * Migration script to import Matching Donors from Webflow to Payload CMS
 * 
 * Usage:
 *   cd litecoin-fund-cms
 *   npx tsx scripts/migrate-matching-donors.ts
 * 
 * Make sure to set environment variables:
 *   - WEBFLOW_API_TOKEN
 *   - WEBFLOW_COLLECTION_ID_MATCHING_DONORS
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

// Fetch collection schema to get option field mappings
async function getCollectionSchema(
  client: ReturnType<typeof createWebflowClient>,
  collectionId: string
): Promise<any> {
  const response = await client.get(`/collections/${collectionId}`)
  return response.data
}

// Create a map from option ID to label for a given field
async function createOptionIdToLabelMap(
  client: ReturnType<typeof createWebflowClient>,
  collectionId: string,
  fieldSlug: string
): Promise<Record<string, string>> {
  const schema = await getCollectionSchema(client, collectionId)
  const map: Record<string, string> = {}

  const field = schema.fields?.find((f: any) => f.slug === fieldSlug)
  if (field?.validations?.options) {
    for (const option of field.validations.options) {
      map[option.id] = option.name
    }
  }

  return map
}

// Webflow types for Matching Donors
interface WebflowMatchingDonor {
  id: string
  slug: string
  isDraft: boolean
  isArchived: boolean
  fieldData: {
    name: string
    'matching-type': string // Option field, returns option ID
    'total-matching-amount': number | string
    'supported-projects'?: string[] // Array of Webflow project IDs
    'start-date': string
    'end-date': string
    multiplier?: number
    status: string // Option field, returns option ID
    contributor?: string // Webflow contributor ID
  }
}

// Map to store Webflow ID -> Payload ID
const matchingDonorIdMap = new Map<string, number>()

async function migrateMatchingDonors(payload: Awaited<ReturnType<typeof getPayload>>) {
  console.log('\n📦 Migrating Matching Donors...')
  
  const apiToken = process.env.WEBFLOW_API_TOKEN
  const collectionId = process.env.WEBFLOW_COLLECTION_ID_MATCHING_DONORS

  if (!apiToken || !collectionId) {
    console.error('❌ Error: Webflow API credentials not configured for matching donors')
    console.error('   Please set WEBFLOW_API_TOKEN and WEBFLOW_COLLECTION_ID_MATCHING_DONORS')
    process.exit(1)
  }

  const client = createWebflowClient(apiToken)
  
  // Get option mappings for status and matching-type fields
  console.log('  Fetching Webflow collection schema...')
  const statusMap = await createOptionIdToLabelMap(client, collectionId, 'status')
  const matchingTypeMap = await createOptionIdToLabelMap(client, collectionId, 'matching-type')
  
  console.log('  Status options:', statusMap)
  console.log('  Matching type options:', matchingTypeMap)

  // Fetch all matching donors from Webflow
  console.log('  Fetching matching donors from Webflow...')
  const webflowDonors = await listCollectionItems<WebflowMatchingDonor>(client, collectionId)

  // Filter to only active (not draft/archived) donors
  const activeDonors = webflowDonors.filter((d) => !d.isDraft && !d.isArchived)
  console.log(`  Found ${activeDonors.length} active matching donors in Webflow`)

  // First, load existing projects to map Webflow IDs to Payload IDs
  console.log('  Loading existing projects from Payload...')
  const payloadProjects = await payload.find({
    collection: 'projects',
    limit: 1000,
  })
  
  // We need to load project slugs from Webflow to map IDs
  const projectCollectionId = process.env.WEBFLOW_COLLECTION_ID_PROJECTS
  let webflowProjectMap = new Map<string, string>() // Webflow ID -> slug
  
  if (projectCollectionId) {
    console.log('  Loading project mappings from Webflow...')
    const webflowProjects = await listCollectionItems<any>(client, projectCollectionId)
    for (const proj of webflowProjects) {
      const slug = proj.fieldData?.slug || proj.slug
      if (slug) {
        webflowProjectMap.set(proj.id, slug)
      }
    }
  }

  // Create Payload slug -> ID map
  const payloadProjectSlugMap = new Map<string, number>()
  for (const proj of payloadProjects.docs) {
    payloadProjectSlugMap.set(proj.slug, proj.id)
  }

  // Load existing contributors for contributor mapping
  console.log('  Loading existing contributors from Payload...')
  const payloadContributors = await payload.find({
    collection: 'contributors',
    limit: 1000,
  })
  
  // Load contributor mappings from Webflow
  const contributorCollectionId = process.env.WEBFLOW_COLLECTION_ID_CONTRIBUTORS
  let webflowContributorMap = new Map<string, string>() // Webflow ID -> slug
  
  if (contributorCollectionId) {
    console.log('  Loading contributor mappings from Webflow...')
    const webflowContributors = await listCollectionItems<any>(client, contributorCollectionId)
    for (const contrib of webflowContributors) {
      const slug = contrib.fieldData?.slug || contrib.slug
      if (slug) {
        webflowContributorMap.set(contrib.id, slug)
      }
    }
  }

  // Create Payload slug -> ID map for contributors
  const payloadContributorSlugMap = new Map<string, number>()
  for (const contrib of payloadContributors.docs) {
    payloadContributorSlugMap.set(contrib.slug, contrib.id)
  }

  let created = 0
  let updated = 0
  let skipped = 0

  for (const webflowDonor of activeDonors) {
    try {
      const name = webflowDonor.fieldData.name || 'Unknown Donor'
      
      // Map status option ID to label, then to Payload value
      const statusLabel = statusMap[webflowDonor.fieldData.status] || 'Unknown'
      const status = statusLabel.toLowerCase() === 'active' ? 'active' : 'inactive'

      // Map matching type option ID to label, then to Payload value
      const matchingTypeLabel = matchingTypeMap[webflowDonor.fieldData['matching-type']] || 'Unknown'
      let matchingType: 'all-projects' | 'per-project' = 'all-projects'
      if (matchingTypeLabel.toLowerCase().includes('per') || matchingTypeLabel.toLowerCase().includes('specific')) {
        matchingType = 'per-project'
      }

      // Parse dates
      const startDate = webflowDonor.fieldData['start-date'] 
        ? new Date(webflowDonor.fieldData['start-date']).toISOString().split('T')[0]
        : new Date().toISOString().split('T')[0]
      
      const endDate = webflowDonor.fieldData['end-date']
        ? new Date(webflowDonor.fieldData['end-date']).toISOString().split('T')[0]
        : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0] // 1 year from now

      // Parse total matching amount
      const totalMatchingAmount = Number(webflowDonor.fieldData['total-matching-amount']) || 0

      // Parse multiplier
      const multiplier = webflowDonor.fieldData.multiplier || 1

      // Map supported projects (Webflow IDs -> Payload IDs)
      const supportedProjectIds: number[] = []
      if (webflowDonor.fieldData['supported-projects']) {
        for (const webflowProjectId of webflowDonor.fieldData['supported-projects']) {
          const projectSlug = webflowProjectMap.get(webflowProjectId)
          if (projectSlug) {
            const payloadProjectId = payloadProjectSlugMap.get(projectSlug)
            if (payloadProjectId) {
              supportedProjectIds.push(payloadProjectId)
            } else {
              console.warn(`    ⚠️  Project with slug "${projectSlug}" not found in Payload`)
            }
          } else {
            console.warn(`    ⚠️  Webflow project ID "${webflowProjectId}" not found`)
          }
        }
      }

      // Map contributor (if any)
      let contributorId: number | undefined
      if (webflowDonor.fieldData.contributor) {
        const contributorSlug = webflowContributorMap.get(webflowDonor.fieldData.contributor)
        if (contributorSlug) {
          contributorId = payloadContributorSlugMap.get(contributorSlug)
        }
      }

      // Check if donor already exists by Webflow ID (allows multiple donors with same name)
      const existing = await payload.find({
        collection: 'matching-donors',
        where: {
          webflowId: {
            equals: webflowDonor.id,
          },
        },
        limit: 1,
      })

      const donorData = {
        webflowId: webflowDonor.id,
        name,
        matchingType,
        totalMatchingAmount,
        supportedProjects: supportedProjectIds.length > 0 ? supportedProjectIds : undefined,
        startDate,
        endDate,
        multiplier,
        status,
        contributor: contributorId,
      }

      if (existing.docs.length > 0) {
        // Update existing donor
        await payload.update({
          collection: 'matching-donors',
          id: existing.docs[0].id,
          data: donorData,
        })
        matchingDonorIdMap.set(webflowDonor.id, existing.docs[0].id)
        updated++
        console.log(`  ✓ Updated matching donor: ${name} (${matchingType}, $${totalMatchingAmount})`)
      } else {
        // Create new donor
        const donor = await payload.create({
          collection: 'matching-donors',
          data: donorData,
        })
        matchingDonorIdMap.set(webflowDonor.id, donor.id)
        created++
        console.log(`  ✓ Created matching donor: ${name} (${matchingType}, $${totalMatchingAmount})`)
      }
    } catch (error: any) {
      const name = webflowDonor.fieldData.name || webflowDonor.slug || 'Unknown'
      console.error(`  ✗ Error processing matching donor "${name}":`, error.message)
      if (error.data) {
        console.error(`    Details:`, JSON.stringify(error.data, null, 2))
      }
      skipped++
    }
  }

  console.log(`\n✅ Migration completed!`)
  console.log(`   - Created: ${created}`)
  console.log(`   - Updated: ${updated}`)
  console.log(`   - Skipped/Errors: ${skipped}`)
  console.log(`   - Total: ${matchingDonorIdMap.size}`)
}

async function main() {
  console.log('🚀 Starting Matching Donors migration from Webflow to Payload CMS...\n')
  console.log(`✓ PAYLOAD_SECRET: ${process.env.PAYLOAD_SECRET ? 'Set' : 'Missing'}`)
  console.log(`✓ DATABASE_URI: ${process.env.DATABASE_URI ? 'Set' : 'Missing'}`)
  console.log(`✓ WEBFLOW_API_TOKEN: ${process.env.WEBFLOW_API_TOKEN ? 'Set' : 'Missing'}`)
  console.log(`✓ WEBFLOW_COLLECTION_ID_MATCHING_DONORS: ${process.env.WEBFLOW_COLLECTION_ID_MATCHING_DONORS ? 'Set' : 'Missing'}\n`)

  // Dynamically import config after env vars are loaded
  const { default: config } = await import('../src/payload.config')

  // Initialize Payload
  const payload = await getPayload({ config })

  try {
    await migrateMatchingDonors(payload)
  } catch (error) {
    console.error('❌ Migration failed:', error)
    process.exit(1)
  } finally {
    process.exit(0)
  }
}

main()
