/**
 * Script to identify missing images in Payload CMS
 * 
 * Usage:
 *   cd litecoin-fund-cms
 *   npx tsx scripts/identify-missing-images.ts
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

interface WebflowContributor {
  id: string
  fieldData: {
    name?: string
    slug?: string
    'profile-picture'?: {
      url: string
      alt: string | null
    }
  }
}

interface WebflowProject {
  id: string
  fieldData: {
    name: string
    slug?: string
    'cover-image'?: {
      url: string
      alt: string | null
    }
  }
}

async function main() {
  console.log('🔍 Identifying missing images in Payload CMS...\n')

  const apiToken = process.env.WEBFLOW_API_TOKEN
  if (!apiToken) {
    console.error('❌ Error: WEBFLOW_API_TOKEN is not set')
    process.exit(1)
  }

  const client = createWebflowClient(apiToken)

  // Check contributors
  const contributorsCollectionId = process.env.WEBFLOW_COLLECTION_ID_CONTRIBUTORS
  const contributorsMissing: Array<{ name: string; slug: string; url: string }> = []

  if (contributorsCollectionId) {
    try {
      const webflowContributors = await listCollectionItems<WebflowContributor>(
        client,
        contributorsCollectionId
      )
      const activeContributors = webflowContributors.filter((c) => !c.isDraft && !c.isArchived)

      const payloadContributors = await listPayloadItems('contributors')
      const payloadContributorsBySlug = new Map(payloadContributors.map((c) => [c.slug, c]))

      for (const webflowContributor of activeContributors) {
        const profilePicture = webflowContributor.fieldData['profile-picture']
        if (profilePicture && profilePicture.url) {
          const slug = webflowContributor.fieldData.slug || webflowContributor.id
          const payloadContributor = payloadContributorsBySlug.get(slug)

          if (!payloadContributor || !payloadContributor.profilePicture) {
            contributorsMissing.push({
              name: webflowContributor.fieldData.name || 'Unknown',
              slug: slug,
              url: profilePicture.url,
            })
          }
        }
      }
    } catch (error: any) {
      console.error('❌ Error checking contributors:', error.message)
    }
  }

  // Check projects
  const projectsCollectionId = process.env.WEBFLOW_COLLECTION_ID_PROJECTS
  const projectsMissing: Array<{ name: string; slug: string; url: string }> = []

  if (projectsCollectionId) {
    try {
      const webflowProjects = await listCollectionItems<WebflowProject>(client, projectsCollectionId)
      const publishedProjects = webflowProjects.filter(
        (p) => !p.isDraft && !p.isArchived && !p.fieldData.hidden
      )

      const payloadProjects = await listPayloadItems('projects')
      const payloadProjectsBySlug = new Map(payloadProjects.map((p) => [p.slug, p]))

      for (const webflowProject of publishedProjects) {
        const coverImage = webflowProject.fieldData['cover-image']
        if (coverImage && coverImage.url) {
          const slug = webflowProject.fieldData.slug || webflowProject.id
          const payloadProject = payloadProjectsBySlug.get(slug)

          if (!payloadProject || !payloadProject.coverImage) {
            projectsMissing.push({
              name: webflowProject.fieldData.name,
              slug: slug,
              url: coverImage.url,
            })
          }
        }
      }
    } catch (error: any) {
      console.error('❌ Error checking projects:', error.message)
    }
  }

  // Print results
  console.log('📊 Missing Images Report:\n')

  console.log(`Contributors missing profile pictures: ${contributorsMissing.length}`)
  if (contributorsMissing.length > 0) {
    console.log('\n  Missing Contributor Images:')
    contributorsMissing.forEach((item, index) => {
      console.log(`    ${index + 1}. ${item.name} (${item.slug})`)
      console.log(`       URL: ${item.url}`)
    })
  }

  console.log(`\nProjects missing cover images: ${projectsMissing.length}`)
  if (projectsMissing.length > 0) {
    console.log('\n  Missing Project Images:')
    projectsMissing.forEach((item, index) => {
      console.log(`    ${index + 1}. ${item.name} (${item.slug})`)
      console.log(`       URL: ${item.url}`)
    })
  }

  console.log(`\n📈 Summary:`)
  console.log(`   Total missing images: ${contributorsMissing.length + projectsMissing.length}`)
  console.log(`   - Contributor profile pictures: ${contributorsMissing.length}`)
  console.log(`   - Project cover images: ${projectsMissing.length}`)

  if (contributorsMissing.length > 0 || projectsMissing.length > 0) {
    console.log('\n💡 Run the image migration script to upload these images:')
    console.log('   npx tsx scripts/migrate-images.ts')
  }
}

main().catch((error) => {
  console.error('❌ Identification failed:', error)
  process.exit(1)
})
