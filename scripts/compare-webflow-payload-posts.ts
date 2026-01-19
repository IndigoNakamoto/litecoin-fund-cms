/**
 * Compare Webflow posts with Payload CMS posts to find missing links
 * 
 * Usage:
 *   cd payload-cms
 *   npx tsx scripts/compare-webflow-payload-posts.ts
 */

// Load environment variables FIRST
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
dotenv.config({ path: path.resolve(__dirname, '../.env') })

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

async function listAllWebflowItems<T>(
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

interface WebflowPost {
  id: string
  isDraft: boolean
  isArchived: boolean
  fieldData: {
    link?: string
    'x-post-link'?: string
    'youtube-link'?: string
    'reddit-link'?: string
    projects?: string[]
    name?: string
    slug?: string
  }
}

async function main() {
  const apiToken = process.env.WEBFLOW_API_TOKEN
  const collectionId = process.env.WEBFLOW_COLLECTION_ID_POSTS

  if (!apiToken || !collectionId) {
    console.error('❌ Error: WEBFLOW_API_TOKEN or WEBFLOW_COLLECTION_ID_POSTS not set')
    process.exit(1)
  }

  // Dynamically import config after env vars are loaded
  const { default: config } = await import('../src/payload.config.js')

  const client = createWebflowClient(apiToken)
  const payload = await getPayload({ config })

  try {
    console.log('🔍 Comparing Webflow and Payload posts...\n')

    // Fetch all Webflow posts
    console.log('📥 Fetching Webflow posts...')
    const webflowPosts = await listAllWebflowItems<WebflowPost>(client, collectionId)
    const activeWebflowPosts = webflowPosts.filter((p) => !p.isDraft && !p.isArchived)
    console.log(`Found ${activeWebflowPosts.length} active posts in Webflow\n`)

    // Fetch all Payload posts
    console.log('📥 Fetching Payload posts...')
    const payloadResult = await payload.find({
      collection: 'posts',
      limit: 1000,
    })
    const payloadPosts = payloadResult.docs
    console.log(`Found ${payloadPosts.length} posts in Payload\n`)

    console.log('='.repeat(80))
    console.log('COMPARISON RESULTS')
    console.log('='.repeat(80))

    // Compare posts
    for (const webflowPost of activeWebflowPosts) {
      const webflowLink = webflowPost.fieldData.link || 
                          webflowPost.fieldData['x-post-link'] || 
                          webflowPost.fieldData['youtube-link'] || 
                          webflowPost.fieldData['reddit-link']

      // Find matching Payload post by projects
      const webflowProjectIds = webflowPost.fieldData.projects || []
      const matchingPayloadPost = payloadPosts.find((pp) => {
        const payloadProjectIds = Array.isArray(pp.projects)
          ? pp.projects.map((p: any) => (typeof p === 'number' ? p.toString() : p.id?.toString()))
          : []
        return webflowProjectIds.some((wfId) => payloadProjectIds.includes(wfId))
      })

      if (webflowLink) {
        console.log(`\n📋 Post: ${webflowPost.fieldData.name || webflowPost.id}`)
        console.log(`   Webflow link: ${webflowLink}`)

        if (matchingPayloadPost) {
          const payloadXLink = matchingPayloadPost.xPostLink
          const payloadYoutubeLink = matchingPayloadPost.youtubeLink
          const payloadRedditLink = matchingPayloadPost.redditLink
          const hasAnyLink = payloadXLink || payloadYoutubeLink || payloadRedditLink

          console.log(`   Payload links:`)
          console.log(`     - X/Twitter: ${payloadXLink || '(none)'}`)
          console.log(`     - YouTube: ${payloadYoutubeLink || '(none)'}`)
          console.log(`     - Reddit: ${payloadRedditLink || '(none)'}`)

          // Check if link is missing or incorrect
          const lowerLink = webflowLink.toLowerCase()
          if (lowerLink.includes('x.com') || lowerLink.includes('twitter.com')) {
            if (!payloadXLink || payloadXLink !== webflowLink) {
              console.log(`   ⚠️  MISSING/INCORRECT: X/Twitter link should be "${webflowLink}"`)
            }
          } else if (lowerLink.includes('youtube.com') || lowerLink.includes('youtu.be')) {
            if (!payloadYoutubeLink || payloadYoutubeLink !== webflowLink) {
              console.log(`   ⚠️  MISSING/INCORRECT: YouTube link should be "${webflowLink}"`)
            }
          } else if (lowerLink.includes('reddit.com')) {
            if (!payloadRedditLink || payloadRedditLink !== webflowLink) {
              console.log(`   ⚠️  MISSING/INCORRECT: Reddit link should be "${webflowLink}"`)
            }
          } else {
            if (!hasAnyLink) {
              console.log(`   ⚠️  MISSING: Link exists in Webflow but not migrated (unrecognized type)`)
            }
          }
        } else {
          console.log(`   ❌ NOT FOUND in Payload`)
        }
      } else {
        console.log(`\n📋 Post: ${webflowPost.fieldData.name || webflowPost.id}`)
        console.log(`   Webflow link: (none)`)
      }
    }

    console.log('\n' + '='.repeat(80))
    console.log('Summary:')
    console.log(`  Webflow posts with links: ${activeWebflowPosts.filter(p => 
      p.fieldData.link || p.fieldData['x-post-link'] || p.fieldData['youtube-link'] || p.fieldData['reddit-link']
    ).length}`)
    console.log(`  Payload posts with links: ${payloadPosts.filter(p => 
      p.xPostLink || p.youtubeLink || p.redditLink
    ).length}`)
    console.log('='.repeat(80))

  } catch (error: any) {
    console.error('❌ Error:', error.message)
    if (error.response) {
      console.error('Response:', error.response.data)
    }
    process.exit(1)
  } finally {
    process.exit(0)
  }
}

main()
