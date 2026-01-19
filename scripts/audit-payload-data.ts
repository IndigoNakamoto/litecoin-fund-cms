/**
 * Audit script to check current Payload CMS data state
 * 
 * Usage:
 *   cd payload-cms
 *   npx tsx scripts/audit-payload-data.ts
 */

// Load environment variables FIRST
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
dotenv.config({ path: path.resolve(__dirname, '../.env') })

// Verify required environment variables
if (!process.env.PAYLOAD_SECRET) {
  console.error('❌ Error: PAYLOAD_SECRET is not set in .env file')
  process.exit(1)
}

if (!process.env.DATABASE_URI) {
  console.error('❌ Error: DATABASE_URI is not set in .env file')
  process.exit(1)
}

import { getPayload } from 'payload'
import { default as config } from '../src/payload.config.js'

interface AuditResult {
  collection: string
  total: number
  withImages: number
  missingImages: number
  incomplete: number
}

async function auditCollection(
  payload: Awaited<ReturnType<typeof getPayload>>,
  collectionSlug: string,
  imageField?: string
): Promise<AuditResult> {
  const result = await payload.find({
    collection: collectionSlug,
    limit: 1000,
    depth: 1,
  })

  const total = result.totalDocs
  let withImages = 0
  let missingImages = 0
  let incomplete = 0

  for (const doc of result.docs) {
    if (imageField) {
      const image = (doc as any)[imageField]
      if (image && typeof image === 'object' && image.id) {
        withImages++
      } else {
        missingImages++
      }
    }

    // Check for incomplete records (missing required fields)
    const hasNullFields = Object.values(doc).some(
      (val) => val === null || val === undefined || val === ''
    )
    if (hasNullFields) {
      incomplete++
    }
  }

  return {
    collection: collectionSlug,
    total,
    withImages,
    missingImages,
    incomplete,
  }
}

async function main() {
  console.log('🔍 Auditing Payload CMS data...\n')

  // Initialize Payload
  const payload = await getPayload({ config })

  try {
    // Audit each collection
    const collections = [
      { slug: 'contributors', imageField: 'profilePicture' },
      { slug: 'projects', imageField: 'coverImage' },
      { slug: 'faqs', imageField: undefined },
      { slug: 'posts', imageField: undefined },
      { slug: 'updates', imageField: undefined },
      { slug: 'media', imageField: undefined },
    ]

    const results: AuditResult[] = []

    for (const { slug, imageField } of collections) {
      try {
        const result = await auditCollection(payload, slug, imageField)
        results.push(result)
      } catch (error: any) {
        console.error(`❌ Error auditing ${slug}:`, error.message)
      }
    }

    // Print results
    console.log('📊 Audit Results:\n')
    console.log('Collection'.padEnd(20), 'Total'.padEnd(10), 'With Images'.padEnd(15), 'Missing Images'.padEnd(18), 'Incomplete')
    console.log('-'.repeat(80))

    for (const result of results) {
      const imageInfo = result.missingImages > 0
        ? `${result.withImages}/${result.missingImages}`
        : result.withImages > 0
        ? `${result.withImages}`
        : 'N/A'

      console.log(
        result.collection.padEnd(20),
        result.total.toString().padEnd(10),
        imageInfo.padEnd(15),
        result.missingImages > 0 ? result.missingImages.toString().padEnd(18) : 'N/A'.padEnd(18),
        result.incomplete
      )
    }

    // Summary
    const totalProjects = results.find((r) => r.collection === 'projects')?.total || 0
    const totalContributors = results.find((r) => r.collection === 'contributors')?.total || 0
    const projectsWithImages = results.find((r) => r.collection === 'projects')?.withImages || 0
    const contributorsWithImages = results.find((r) => r.collection === 'contributors')?.withImages || 0
    const totalMedia = results.find((r) => r.collection === 'media')?.total || 0

    console.log('\n📈 Summary:')
    console.log(`   Projects: ${totalProjects} (${projectsWithImages} with cover images)`)
    console.log(`   Contributors: ${totalContributors} (${contributorsWithImages} with profile pictures)`)
    console.log(`   Media files: ${totalMedia}`)
    console.log(`   FAQs: ${results.find((r) => r.collection === 'faqs')?.total || 0}`)
    console.log(`   Posts: ${results.find((r) => r.collection === 'posts')?.total || 0}`)
    console.log(`   Updates: ${results.find((r) => r.collection === 'updates')?.total || 0}`)

    if (projectsWithImages < totalProjects || contributorsWithImages < totalContributors) {
      console.log('\n⚠️  Missing images detected!')
      console.log(`   Projects missing cover images: ${totalProjects - projectsWithImages}`)
      console.log(`   Contributors missing profile pictures: ${totalContributors - contributorsWithImages}`)
    }
  } catch (error) {
    console.error('❌ Audit failed:', error)
    process.exit(1)
  } finally {
    process.exit(0)
  }
}

main()
