/**
 * Compare Webflow data with Payload CMS data to identify outdated records
 * 
 * Usage:
 *   cd litecoin-fund-cms
 *   npx tsx scripts/compare-webflow-payload.ts
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

// Payload API client
const payloadClient = axios.create({
  baseURL: PAYLOAD_API_URL,
  headers: {
    'Content-Type': 'application/json',
    ...(PAYLOAD_API_TOKEN && { Authorization: `Bearer ${PAYLOAD_API_TOKEN}` }),
  },
})

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

interface ComparisonResult {
  collection: string
  webflowCount: number
  payloadCount: number
  missingInPayload: number
  extraInPayload: number
  outdated: number
}

async function compareCollection(
  webflowClient: ReturnType<typeof createWebflowClient>,
  webflowCollectionId: string | undefined,
  payloadCollectionSlug: string,
  getSlug: (item: any) => string
): Promise<ComparisonResult> {
  let webflowItems: any[] = []
  let payloadItems: any[] = []

  if (webflowCollectionId) {
    try {
      webflowItems = await listCollectionItems(webflowClient, webflowCollectionId)
      // Filter to only published/active items
      webflowItems = webflowItems.filter(
        (item) => !item.isDraft && !item.isArchived
      )
    } catch (error: any) {
      console.warn(`⚠️  Could not fetch Webflow ${payloadCollectionSlug}:`, error.message)
    }
  }

  try {
    payloadItems = await listPayloadItems(payloadCollectionSlug)
  } catch (error: any) {
    console.warn(`⚠️  Could not fetch Payload ${payloadCollectionSlug}:`, error.message)
  }

  const webflowSlugs = new Set(webflowItems.map(getSlug))
  const payloadSlugs = new Set(payloadItems.map((p) => p.slug))

  const missingInPayload = webflowItems.filter(
    (item) => !payloadSlugs.has(getSlug(item))
  ).length

  const extraInPayload = payloadItems.filter(
    (item) => !webflowSlugs.has(item.slug)
  ).length

  // For now, assume all existing items might be outdated
  const outdated = payloadItems.length - extraInPayload

  return {
    collection: payloadCollectionSlug,
    webflowCount: webflowItems.length,
    payloadCount: payloadItems.length,
    missingInPayload,
    extraInPayload,
    outdated,
  }
}

async function main() {
  console.log('🔍 Comparing Webflow vs Payload CMS data...\n')

  const apiToken = process.env.WEBFLOW_API_TOKEN
  if (!apiToken) {
    console.error('❌ Error: WEBFLOW_API_TOKEN is not set in .env file')
    process.exit(1)
  }

  const webflowClient = createWebflowClient(apiToken)

  const collections = [
    {
      webflowId: process.env.WEBFLOW_COLLECTION_ID_CONTRIBUTORS,
      payloadSlug: 'contributors',
      getSlug: (item: any) => item.fieldData?.slug || item.slug || item.id,
    },
    {
      webflowId: process.env.WEBFLOW_COLLECTION_ID_PROJECTS,
      payloadSlug: 'projects',
      getSlug: (item: any) => item.fieldData?.slug || item.slug || item.id,
    },
    {
      webflowId: process.env.WEBFLOW_COLLECTION_ID_FAQS,
      payloadSlug: 'faqs',
      getSlug: (item: any) => item.id, // FAQs don't have slugs, use ID
    },
    {
      webflowId: process.env.WEBFLOW_COLLECTION_ID_POSTS,
      payloadSlug: 'posts',
      getSlug: (item: any) => item.id, // Posts don't have slugs, use ID
    },
    {
      webflowId: process.env.WEBFLOW_COLLECTION_ID_PROJECT_UPDATES,
      payloadSlug: 'updates',
      getSlug: (item: any) => item.id, // Updates don't have slugs, use ID
    },
  ]

  const results: ComparisonResult[] = []

  for (const { webflowId, payloadSlug, getSlug } of collections) {
    if (!webflowId) {
      console.warn(`⚠️  Skipping ${payloadSlug} - WEBFLOW_COLLECTION_ID not set`)
      continue
    }

    try {
      const result = await compareCollection(webflowClient, webflowId, payloadSlug, getSlug)
      results.push(result)
    } catch (error: any) {
      console.error(`❌ Error comparing ${payloadSlug}:`, error.message)
    }
  }

  // Print results
  console.log('📊 Comparison Results:\n')
  console.log(
    'Collection'.padEnd(20),
    'Webflow'.padEnd(10),
    'Payload'.padEnd(10),
    'Missing'.padEnd(10),
    'Extra'.padEnd(10),
    'Outdated'
  )
  console.log('-'.repeat(80))

  for (const result of results) {
    console.log(
      result.collection.padEnd(20),
      result.webflowCount.toString().padEnd(10),
      result.payloadCount.toString().padEnd(10),
      result.missingInPayload.toString().padEnd(10),
      result.extraInPayload.toString().padEnd(10),
      result.outdated.toString()
    )
  }

  // Summary
  console.log('\n📈 Summary:')
  const totalMissing = results.reduce((sum, r) => sum + r.missingInPayload, 0)
  const totalOutdated = results.reduce((sum, r) => sum + r.outdated, 0)
  const totalExtra = results.reduce((sum, r) => sum + r.extraInPayload, 0)

  console.log(`   Missing in Payload: ${totalMissing} items`)
  console.log(`   Potentially outdated: ${totalOutdated} items`)
  console.log(`   Extra in Payload: ${totalExtra} items`)

  if (totalMissing > 0 || totalOutdated > 0) {
    console.log('\n⚠️  Action needed:')
    if (totalMissing > 0) {
      console.log(`   - ${totalMissing} items need to be migrated from Webflow`)
    }
    if (totalOutdated > 0) {
      console.log(`   - ${totalOutdated} items may need to be refreshed`)
    }
  }
}

main().catch((error) => {
  console.error('❌ Comparison failed:', error)
  process.exit(1)
})
