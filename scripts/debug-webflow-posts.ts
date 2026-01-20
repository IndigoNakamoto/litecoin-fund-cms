/**
 * Debug script to check what fields actually exist in Webflow posts
 * 
 * Usage:
 *   cd litecoin-fund-cms
 *   npx tsx scripts/debug-webflow-posts.ts
 */

// Load environment variables FIRST
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
dotenv.config({ path: path.resolve(__dirname, '../.env') })

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

async function main() {
  const apiToken = process.env.WEBFLOW_API_TOKEN
  const collectionId = process.env.WEBFLOW_COLLECTION_ID_POSTS

  if (!apiToken || !collectionId) {
    console.error('❌ Error: WEBFLOW_API_TOKEN or WEBFLOW_COLLECTION_ID_POSTS not set')
    process.exit(1)
  }

  const client = createWebflowClient(apiToken)

  try {
    console.log('🔍 Fetching posts from Webflow...\n')
    
    // Fetch first few posts to inspect
    const response = await client.get(`/collections/${collectionId}/items`, {
      params: {
        limit: 5,
        offset: 0,
      },
    })

    const { items } = response.data
    console.log(`Found ${items.length} posts (showing first ${items.length})\n`)

    items.forEach((post: any, index: number) => {
      console.log(`\n--- Post ${index + 1} (ID: ${post.id}) ---`)
      console.log(`Draft: ${post.isDraft}, Archived: ${post.isArchived}`)
      console.log(`\nAll field names in fieldData:`)
      console.log(Object.keys(post.fieldData || {}))
      console.log(`\nField Data:`)
      console.log(JSON.stringify(post.fieldData, null, 2))
      console.log(`\n---`)
    })

    // Also check collection schema to see what fields exist
    console.log('\n\n📋 Checking collection schema...\n')
    const schemaResponse = await client.get(`/collections/${collectionId}`)
    const collection = schemaResponse.data
    console.log('Collection fields:')
    collection.fields?.forEach((field: any) => {
      console.log(`  - ${field.slug || field.name} (${field.type || 'unknown'})`)
    })
  } catch (error: any) {
    console.error('❌ Error:', error.message)
    if (error.response) {
      console.error('Response:', error.response.data)
    }
    process.exit(1)
  }
}

main()
