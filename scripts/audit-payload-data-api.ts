/**
 * Audit script to check current Payload CMS data state via API
 * 
 * Usage:
 *   cd litecoin-fund-cms
 *   npx tsx scripts/audit-payload-data-api.ts
 */

import axios from 'axios'

const PAYLOAD_API_URL = process.env.PAYLOAD_API_URL || 'http://localhost:3001/api'
const PAYLOAD_API_TOKEN = process.env.PAYLOAD_API_TOKEN

const client = axios.create({
  baseURL: PAYLOAD_API_URL,
  headers: {
    'Content-Type': 'application/json',
    ...(PAYLOAD_API_TOKEN && { Authorization: `Bearer ${PAYLOAD_API_TOKEN}` }),
  },
})

interface CollectionStats {
  collection: string
  total: number
  withImages: number
  missingImages: number
  sample: any[]
}

async function auditCollection(collectionSlug: string, imageField?: string): Promise<CollectionStats> {
  try {
    const response = await client.get(`/${collectionSlug}`, {
      params: {
        limit: 1000,
        depth: 1,
      },
    })

    const docs = response.data.docs || []
    const total = response.data.totalDocs || docs.length

    let withImages = 0
    let missingImages = 0

    for (const doc of docs) {
      if (imageField) {
        const image = doc[imageField]
        if (image && typeof image === 'object' && (image.id || image.url)) {
          withImages++
        } else {
          missingImages++
        }
      }
    }

    return {
      collection: collectionSlug,
      total,
      withImages,
      missingImages,
      sample: docs.slice(0, 3), // First 3 for inspection
    }
  } catch (error: any) {
    if (error.response?.status === 404) {
      return {
        collection: collectionSlug,
        total: 0,
        withImages: 0,
        missingImages: 0,
        sample: [],
      }
    }
    throw error
  }
}

async function main() {
  console.log('🔍 Auditing Payload CMS data via API...\n')
  console.log(`API URL: ${PAYLOAD_API_URL}\n`)

  try {
    const collections = [
      { slug: 'contributors', imageField: 'profilePicture' },
      { slug: 'projects', imageField: 'coverImage' },
      { slug: 'faqs', imageField: undefined },
      { slug: 'posts', imageField: undefined },
      { slug: 'updates', imageField: undefined },
      { slug: 'media', imageField: undefined },
    ]

    const results: CollectionStats[] = []

    for (const { slug, imageField } of collections) {
      try {
        const result = await auditCollection(slug, imageField)
        results.push(result)
      } catch (error: any) {
        console.error(`❌ Error auditing ${slug}:`, error.message)
        results.push({
          collection: slug,
          total: 0,
          withImages: 0,
          missingImages: 0,
          sample: [],
        })
      }
    }

    // Print results
    console.log('📊 Audit Results:\n')
    console.log('Collection'.padEnd(20), 'Total'.padEnd(10), 'With Images'.padEnd(15), 'Missing Images')
    console.log('-'.repeat(70))

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
        result.missingImages > 0 ? result.missingImages.toString() : 'N/A'
      )
    }

    // Summary
    const totalProjects = results.find((r) => r.collection === 'projects')?.total || 0
    const totalContributors = results.find((r) => r.collection === 'contributors')?.total || 0
    const projectsWithImages = results.find((r) => r.collection === 'projects')?.withImages || 0
    const contributorsWithImages = results.find((r) => r.collection === 'contributors')?.withImages || 0
    const totalMedia = results.find((r) => r.collection === 'media')?.total || 0

    console.log('\n📈 Summary:')
    console.log(`   Projects: ${totalProjects} (${projectsWithImages} with cover images, ${totalProjects - projectsWithImages} missing)`)
    console.log(`   Contributors: ${totalContributors} (${contributorsWithImages} with profile pictures, ${totalContributors - contributorsWithImages} missing)`)
    console.log(`   Media files: ${totalMedia}`)
    console.log(`   FAQs: ${results.find((r) => r.collection === 'faqs')?.total || 0}`)
    console.log(`   Posts: ${results.find((r) => r.collection === 'posts')?.total || 0}`)
    console.log(`   Updates: ${results.find((r) => r.collection === 'updates')?.total || 0}`)

    if (projectsWithImages < totalProjects || contributorsWithImages < totalContributors) {
      console.log('\n⚠️  Missing images detected!')
      console.log(`   Projects missing cover images: ${totalProjects - projectsWithImages}`)
      console.log(`   Contributors missing profile pictures: ${totalContributors - contributorsWithImages}`)
    }

    // Show sample data
    console.log('\n📋 Sample Data:')
    const projectsResult = results.find((r) => r.collection === 'projects')
    if (projectsResult && projectsResult.sample.length > 0) {
      console.log('\n   Sample Projects:')
      projectsResult.sample.forEach((p: any) => {
        console.log(`     - ${p.name} (slug: ${p.slug}, coverImage: ${p.coverImage ? '✓' : '✗'})`)
      })
    }

    const contributorsResult = results.find((r) => r.collection === 'contributors')
    if (contributorsResult && contributorsResult.sample.length > 0) {
      console.log('\n   Sample Contributors:')
      contributorsResult.sample.forEach((c: any) => {
        console.log(`     - ${c.name} (slug: ${c.slug}, profilePicture: ${c.profilePicture ? '✓' : '✗'})`)
      })
    }
  } catch (error: any) {
    console.error('❌ Audit failed:', error.message)
    if (error.response) {
      console.error('   Response:', error.response.status, error.response.statusText)
    }
    process.exit(1)
  }
}

main()
