/**
 * Image migration script using local Payload API (getPayload)
 * This avoids REST API multipart form data issues
 * 
 * Usage:
 *   cd payload-cms
 *   npx tsx scripts/migrate-images-local.ts
 */

// Load environment variables FIRST
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'
import axios from 'axios'
import fs from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Load environment variables FIRST, before any imports that might use them
const envPath = path.resolve(__dirname, '../.env')
dotenv.config({ path: envPath })

// Verify required environment variables are loaded
if (!process.env.PAYLOAD_SECRET) {
  console.error('❌ Error: PAYLOAD_SECRET is not set in .env file')
  console.error(`   Looking for .env at: ${envPath}`)
  process.exit(1)
}

if (!process.env.DATABASE_URI) {
  console.error('❌ Error: DATABASE_URI is not set in .env file')
  process.exit(1)
}

// Now import modules that use environment variables
import { getPayload } from 'payload'
// Import config dynamically to ensure env vars are loaded
const { default: config } = await import('../src/payload.config.js')

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

// Download image from URL and save to temp file
async function downloadImageToTemp(url: string, filename: string): Promise<string> {
  const response = await axios.get(url, {
    responseType: 'arraybuffer',
  })
  
  const tempDir = tmpdir()
  const tempPath = join(tempDir, filename)
  
  fs.writeFileSync(tempPath, Buffer.from(response.data))
  return tempPath
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

// Map to store Webflow ID -> Payload ID
const contributorIdMap = new Map<string, number>()
const projectIdMap = new Map<string, number>()

async function migrateContributorImages(payload: Awaited<ReturnType<typeof getPayload>>) {
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

  // Get existing Payload contributors
  const payloadContributorsResult = await payload.find({
    collection: 'contributors',
    limit: 1000,
  })
  const payloadContributors = payloadContributorsResult.docs
  const payloadContributorsBySlug = new Map(payloadContributors.map((c) => [c.slug, c]))

  console.log(`Found ${activeContributors.length} active contributors in Webflow`)
  console.log(`Found ${payloadContributors.length} existing contributors in Payload`)

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

      // Download image to temp file
      console.log(`  📥 Downloading image for "${webflowContributor.fieldData.name}"...`)
      const tempPath = await downloadImageToTemp(profilePicture.url, filename)

      try {
        // Upload using local Payload API
        const altText = profilePicture.alt || webflowContributor.fieldData.name || 'Profile picture'
        
        const media = await payload.create({
          collection: 'media',
          data: {
            alt: altText,
          },
          file: {
            data: fs.readFileSync(tempPath),
            mimetype: 'image/jpeg', // Will be auto-detected, but specify for safety
            name: filename,
            size: fs.statSync(tempPath).size,
          },
        })

        // Link image to contributor
        await payload.update({
          collection: 'contributors',
          id: payloadContributor.id,
          data: {
            profilePicture: media.id,
          },
        })

        uploaded++
        linked++
        console.log(`  ✓ Uploaded and linked image for "${webflowContributor.fieldData.name}"`)
      } finally {
        // Clean up temp file
        try {
          fs.unlinkSync(tempPath)
        } catch {
          // Ignore cleanup errors
        }
      }
    } catch (error: any) {
      const name = webflowContributor.fieldData.name || webflowContributor.slug || 'Unknown'
      console.error(`  ✗ Error processing contributor "${name}":`, error.message)
      if (error.data) {
        console.error(`    Details:`, JSON.stringify(error.data, null, 2))
      }
    }
  }

  console.log(`✅ Contributor images: ${uploaded} uploaded, ${linked} linked, ${skipped} skipped\n`)
}

async function migrateProjectImages(payload: Awaited<ReturnType<typeof getPayload>>) {
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

  // Get existing Payload projects
  const payloadProjectsResult = await payload.find({
    collection: 'projects',
    limit: 1000,
  })
  const payloadProjects = payloadProjectsResult.docs
  const payloadProjectsBySlug = new Map(payloadProjects.map((p) => [p.slug, p]))

  console.log(`Found ${publishedProjects.length} published projects in Webflow`)
  console.log(`Found ${payloadProjects.length} existing projects in Payload`)

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

      // Download image to temp file
      console.log(`  📥 Downloading image for "${webflowProject.fieldData.name}"...`)
      const tempPath = await downloadImageToTemp(coverImage.url, filename)

      try {
        // Upload using local Payload API
        const altText = coverImage.alt || webflowProject.fieldData.name || 'Cover image'
        
        const media = await payload.create({
          collection: 'media',
          data: {
            alt: altText,
          },
          file: {
            data: fs.readFileSync(tempPath),
            mimetype: 'image/jpeg', // Will be auto-detected
            name: filename,
            size: fs.statSync(tempPath).size,
          },
        })

        // Link image to project
        await payload.update({
          collection: 'projects',
          id: payloadProject.id,
          data: {
            coverImage: media.id,
          },
        })

        uploaded++
        linked++
        console.log(`  ✓ Uploaded and linked image for "${webflowProject.fieldData.name}"`)
      } finally {
        // Clean up temp file
        try {
          fs.unlinkSync(tempPath)
        } catch {
          // Ignore cleanup errors
        }
      }
    } catch (error: any) {
      const name = webflowProject.fieldData.name || webflowProject.slug || 'Unknown'
      console.error(`  ✗ Error processing project "${name}":`, error.message)
      if (error.data) {
        console.error(`    Details:`, JSON.stringify(error.data, null, 2))
      }
    }
  }

  console.log(`✅ Project images: ${uploaded} uploaded, ${linked} linked, ${skipped} skipped\n`)
}

async function main() {
  console.log('🚀 Starting image migration from Webflow to Payload CMS (Local API)...\n')
  console.log(`✓ PAYLOAD_SECRET: ${process.env.PAYLOAD_SECRET ? 'Set' : 'Missing'}`)
  console.log(`✓ DATABASE_URI: ${process.env.DATABASE_URI ? 'Set' : 'Missing'}\n`)

  // Import config dynamically
  const { default: config } = await import('../src/payload.config.js')
  
  // Initialize Payload
  const payload = await getPayload({ config })

  try {
    await migrateContributorImages(payload)
    await migrateProjectImages(payload)

    console.log('✅ Image migration completed!')
  } catch (error: any) {
    console.error('❌ Image migration failed:', error.message)
    if (error.stack) {
      console.error('Stack:', error.stack)
    }
    process.exit(1)
  } finally {
    process.exit(0)
  }
}

main()
