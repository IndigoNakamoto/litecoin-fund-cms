/**
 * Image migration script to download images from Webflow and upload to Payload CMS
 * 
 * Usage:
 *   cd litecoin-fund-cms
 *   npx tsx scripts/migrate-images.ts
 * 
 * This script:
 * 1. Fetches image URLs from Webflow (cover images, profile pictures)
 * 2. Downloads images from Webflow CDN
 * 3. Uploads images to Payload CMS Media collection
 * 4. Links images to projects and contributors
 */

import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'
import axios from 'axios'
import fs from 'fs'
import FormData from 'form-data'
import { Readable } from 'stream'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
dotenv.config({ path: path.resolve(__dirname, '../.env') })

const PAYLOAD_API_URL = process.env.PAYLOAD_API_URL || 'http://localhost:3001/api'
const PAYLOAD_API_TOKEN = process.env.PAYLOAD_API_TOKEN

const payloadClient = axios.create({
  baseURL: PAYLOAD_API_URL,
  headers: {
    ...(PAYLOAD_API_TOKEN && { Authorization: `Bearer ${PAYLOAD_API_TOKEN}` }),
  },
  maxContentLength: Infinity,
  maxBodyLength: Infinity,
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

// Download image from URL
async function downloadImage(url: string): Promise<Buffer> {
  const response = await axios.get(url, {
    responseType: 'arraybuffer',
  })
  return Buffer.from(response.data)
}

function tryDecodeURIComponent(input: string): string {
  try {
    return decodeURIComponent(input)
  } catch {
    return input
  }
}

function normalizeFilenameFromUrlSegment(segment: string): string {
  // Strip querystring if present
  const [base] = segment.split('?')
  // Some URLs may be encoded once or multiple times; decode a few passes until stable.
  let out = base ?? segment
  for (let i = 0; i < 3; i++) {
    const next = tryDecodeURIComponent(out)
    if (next === out) break
    out = next
  }
  // Safety: never allow path separators
  out = out.replaceAll('/', '_').replaceAll('\\', '_')
  return out
}

// Upload image to Payload CMS
async function uploadImageToPayload(
  imageBuffer: Buffer,
  filename: string,
  alt: string
): Promise<number> {
  const formData = new FormData()
  
  // Determine content type from filename
  const ext = filename.split('.').pop()?.toLowerCase()
  let contentType = 'image/jpeg'
  if (ext === 'png') contentType = 'image/png'
  else if (ext === 'webp') contentType = 'image/webp'
  else if (ext === 'gif') contentType = 'image/gif'
  else if (ext === 'svg') contentType = 'image/svg+xml'
  
  // Payload might expect alt field first, then file
  // Ensure alt is always a non-empty string (required field)
  const altText = alt && alt.trim() ? alt.trim() : filename.split('.')[0] || 'Image'
  formData.append('alt', altText)
  
  // Append file as buffer with proper options
  formData.append('file', imageBuffer, {
    filename,
    contentType,
    knownLength: imageBuffer.length,
  })

  try {
    const response = await payloadClient.post('/media', formData, {
      headers: {
        ...formData.getHeaders(),
      },
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    })
    return response.data.id || response.data.doc?.id
  } catch (error: any) {
    if (error.response?.status === 403) {
      throw new Error('Authentication required - set PAYLOAD_API_TOKEN in .env')
    }
    if (error.response?.data) {
      console.error(`    Upload error details:`, JSON.stringify(error.response.data, null, 2))
    }
    throw error
  }
}

// Check if image already exists in Payload
async function findExistingImage(filename: string): Promise<number | null> {
  try {
    const response = await payloadClient.get('/media', {
      params: {
        where: {
          filename: {
            equals: filename,
          },
        },
        limit: 1,
      },
    })

    if (response.data.docs && response.data.docs.length > 0) {
      return response.data.docs[0].id
    }
  } catch (error) {
    // Ignore errors, return null
  }
  return null
}

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
    'cover-image'?: {
      fileId: string
      url: string
      alt: string | null
    }
  }
}

async function migrateContributorImages() {
  console.log('\n🖼️  Migrating Contributor Profile Pictures...')

  const apiToken = process.env.WEBFLOW_API_TOKEN
  const collectionId = process.env.WEBFLOW_COLLECTION_ID_CONTRIBUTORS

  if (!apiToken || !collectionId) {
    console.warn('⚠️  Webflow API credentials not configured for contributors, skipping...')
    return
  }

  const client = createWebflowClient(apiToken)
  const webflowContributors = await listCollectionItems<WebflowContributor>(client, collectionId)
  const activeContributors = webflowContributors.filter((c) => !c.isDraft && !c.isArchived)

  const payloadContributors = await listPayloadItems('contributors')
  const payloadContributorsBySlug = new Map(payloadContributors.map((c) => [c.slug, c]))

  let uploaded = 0
  let linked = 0
  let skipped = 0

  for (const webflowContributor of activeContributors) {
    try {
      const profilePicture = webflowContributor.fieldData['profile-picture']
      if (!profilePicture || !profilePicture.url) {
        skipped++
        continue
      }

      const slug = webflowContributor.fieldData.slug || webflowContributor.slug
      const payloadContributor = payloadContributorsBySlug.get(slug)

      if (!payloadContributor) {
        console.warn(`  ⚠️  Contributor "${webflowContributor.fieldData.name}" not found in Payload, skipping`)
        skipped++
        continue
      }

      // Check if already has image
      if (payloadContributor.profilePicture && typeof payloadContributor.profilePicture === 'object') {
        console.log(`  ✓ Contributor "${webflowContributor.fieldData.name}" already has profile picture, skipping`)
        skipped++
        continue
      }

      // Extract filename from URL
      const urlParts = profilePicture.url.split('/')
      const rawFilename = urlParts[urlParts.length - 1] || `profile-${slug}.jpg`
      const filename = normalizeFilenameFromUrlSegment(rawFilename)

      // Check if image already uploaded
      let imageId = await findExistingImage(filename)

      if (!imageId) {
        // Download and upload image
        console.log(`  📥 Downloading image for "${webflowContributor.fieldData.name}"...`)
        const imageBuffer = await downloadImage(profilePicture.url)
        imageId = await uploadImageToPayload(
          imageBuffer,
          filename,
          profilePicture.alt || webflowContributor.fieldData.name || 'Profile picture'
        )
        uploaded++
        console.log(`  ✓ Uploaded image for "${webflowContributor.fieldData.name}"`)
      }

      // Link image to contributor
      try {
        await payloadClient.patch(`/contributors/${payloadContributor.id}`, {
          profilePicture: imageId,
        })
        linked++
        console.log(`  ✓ Linked image to contributor "${webflowContributor.fieldData.name}"`)
      } catch (error: any) {
        if (error.response?.status === 403) {
          console.warn(`  ⚠️  Cannot link image (authentication required) - image ID: ${imageId}`)
        } else {
          throw error
        }
      }
    } catch (error: any) {
      const name = webflowContributor.fieldData.name || webflowContributor.slug || 'Unknown'
      console.error(`  ✗ Error processing contributor "${name}":`, error.message)
    }
  }

  console.log(`✅ Contributor images: ${uploaded} uploaded, ${linked} linked, ${skipped} skipped\n`)
}

async function migrateProjectImages() {
  console.log('\n🖼️  Migrating Project Cover Images...')

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

  const payloadProjects = await listPayloadItems('projects')
  const payloadProjectsBySlug = new Map(payloadProjects.map((p) => [p.slug, p]))

  let uploaded = 0
  let linked = 0
  let skipped = 0

  for (const webflowProject of publishedProjects) {
    try {
      const coverImage = webflowProject.fieldData['cover-image']
      if (!coverImage || !coverImage.url) {
        skipped++
        continue
      }

      const slug = webflowProject.fieldData.slug || webflowProject.slug
      const payloadProject = payloadProjectsBySlug.get(slug)

      if (!payloadProject) {
        console.warn(`  ⚠️  Project "${webflowProject.fieldData.name}" not found in Payload, skipping`)
        skipped++
        continue
      }

      // Check if already has image
      if (payloadProject.coverImage && typeof payloadProject.coverImage === 'object') {
        console.log(`  ✓ Project "${webflowProject.fieldData.name}" already has cover image, skipping`)
        skipped++
        continue
      }

      // Extract filename from URL
      const urlParts = coverImage.url.split('/')
      const rawFilename = urlParts[urlParts.length - 1] || `cover-${slug}.jpg`
      const filename = normalizeFilenameFromUrlSegment(rawFilename)

      // Check if image already uploaded
      let imageId = await findExistingImage(filename)

      if (!imageId) {
        // Download and upload image
        console.log(`  📥 Downloading image for "${webflowProject.fieldData.name}"...`)
        const imageBuffer = await downloadImage(coverImage.url)
        imageId = await uploadImageToPayload(
          imageBuffer,
          filename,
          coverImage.alt || webflowProject.fieldData.name || 'Cover image'
        )
        uploaded++
        console.log(`  ✓ Uploaded image for "${webflowProject.fieldData.name}"`)
      }

      // Link image to project
      try {
        await payloadClient.patch(`/projects/${payloadProject.id}`, {
          coverImage: imageId,
        })
        linked++
        console.log(`  ✓ Linked image to project "${webflowProject.fieldData.name}"`)
      } catch (error: any) {
        if (error.response?.status === 403) {
          console.warn(`  ⚠️  Cannot link image (authentication required) - image ID: ${imageId}`)
        } else {
          throw error
        }
      }
    } catch (error: any) {
      const name = webflowProject.fieldData.name || webflowProject.slug || 'Unknown'
      console.error(`  ✗ Error processing project "${name}":`, error.message)
    }
  }

  console.log(`✅ Project images: ${uploaded} uploaded, ${linked} linked, ${skipped} skipped\n`)
}

async function main() {
  console.log('🚀 Starting image migration from Webflow to Payload CMS...\n')
  console.log(`API URL: ${PAYLOAD_API_URL}\n`)

  if (!PAYLOAD_API_TOKEN) {
    console.warn('⚠️  PAYLOAD_API_TOKEN not set - image linking will fail')
    console.warn('   Images will be uploaded but not linked to projects/contributors\n')
  }

  try {
    await migrateContributorImages()
    await migrateProjectImages()

    console.log('✅ Image migration completed!')
    console.log('\n📝 Note: If images were uploaded but not linked, you can link them manually via the Payload admin panel')
  } catch (error: any) {
    console.error('❌ Image migration failed:', error.message)
    if (error.response) {
      console.error('   Response:', error.response.status, error.response.statusText)
    }
    process.exit(1)
  }
}

main()
