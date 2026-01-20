/**
 * Test data integrity after migration
 * Checks relationships, required fields, and data consistency
 * 
 * Usage:
 *   cd litecoin-fund-cms
 *   npx tsx scripts/test-data-integrity.ts
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
          depth: 2, // Get relationships populated
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

interface IntegrityIssue {
  type: 'missing_field' | 'invalid_relationship' | 'missing_image' | 'invalid_slug'
  collection: string
  item: string
  field?: string
  message: string
}

async function testDataIntegrity() {
  console.log('🔍 Testing Payload CMS data integrity...\n')

  const issues: IntegrityIssue[] = []

  try {
    // Test Projects
    console.log('Testing Projects...')
    const projects = await listPayloadItems('projects')

    for (const project of projects) {
      // Check required fields
      if (!project.name || project.name.trim() === '') {
        issues.push({
          type: 'missing_field',
          collection: 'projects',
          item: project.slug || project.id,
          field: 'name',
          message: 'Project missing name',
        })
      }

      if (!project.slug || project.slug.trim() === '') {
        issues.push({
          type: 'missing_field',
          collection: 'projects',
          item: project.id,
          field: 'slug',
          message: 'Project missing slug',
        })
      }

      if (!project.summary || project.summary.trim() === '') {
        issues.push({
          type: 'missing_field',
          collection: 'projects',
          item: project.slug || project.id,
          field: 'summary',
          message: 'Project missing summary',
        })
      }

      // Check cover image
      if (!project.coverImage) {
        issues.push({
          type: 'missing_image',
          collection: 'projects',
          item: project.slug || project.id,
          message: 'Project missing cover image',
        })
      }

      // Check contributor relationships (if they exist, they should be valid)
      if (project.bitcoinContributors && Array.isArray(project.bitcoinContributors)) {
        for (const contributor of project.bitcoinContributors) {
          if (typeof contributor === 'number' && contributor <= 0) {
            issues.push({
              type: 'invalid_relationship',
              collection: 'projects',
              item: project.slug || project.id,
              field: 'bitcoinContributors',
              message: `Invalid contributor ID: ${contributor}`,
            })
          }
        }
      }

      if (project.litecoinContributors && Array.isArray(project.litecoinContributors)) {
        for (const contributor of project.litecoinContributors) {
          if (typeof contributor === 'number' && contributor <= 0) {
            issues.push({
              type: 'invalid_relationship',
              collection: 'projects',
              item: project.slug || project.id,
              field: 'litecoinContributors',
              message: `Invalid contributor ID: ${contributor}`,
            })
          }
        }
      }

      // Check slug format
      if (project.slug && !/^[a-z0-9-]+$/.test(project.slug)) {
        issues.push({
          type: 'invalid_slug',
          collection: 'projects',
          item: project.slug,
          message: `Invalid slug format: ${project.slug}`,
        })
      }
    }

    console.log(`  ✓ Checked ${projects.length} projects`)

    // Test Contributors
    console.log('Testing Contributors...')
    const contributors = await listPayloadItems('contributors')

    for (const contributor of contributors) {
      // Check required fields
      if (!contributor.name || contributor.name.trim() === '') {
        issues.push({
          type: 'missing_field',
          collection: 'contributors',
          item: contributor.slug || contributor.id,
          field: 'name',
          message: 'Contributor missing name',
        })
      }

      if (!contributor.slug || contributor.slug.trim() === '') {
        issues.push({
          type: 'missing_field',
          collection: 'contributors',
          item: contributor.id,
          field: 'slug',
          message: 'Contributor missing slug',
        })
      }

      // Check profile picture
      if (!contributor.profilePicture) {
        issues.push({
          type: 'missing_image',
          collection: 'contributors',
          item: contributor.slug || contributor.id,
          message: 'Contributor missing profile picture',
        })
      }

      // Check slug format
      if (contributor.slug && !/^[a-z0-9-]+$/.test(contributor.slug)) {
        issues.push({
          type: 'invalid_slug',
          collection: 'contributors',
          item: contributor.slug,
          message: `Invalid slug format: ${contributor.slug}`,
        })
      }
    }

    console.log(`  ✓ Checked ${contributors.length} contributors`)

    // Test FAQs
    console.log('Testing FAQs...')
    const faqs = await listPayloadItems('faqs')

    for (const faq of faqs) {
      if (!faq.question || faq.question.trim() === '') {
        issues.push({
          type: 'missing_field',
          collection: 'faqs',
          item: faq.id,
          field: 'question',
          message: 'FAQ missing question',
        })
      }

      if (!faq.answer) {
        issues.push({
          type: 'missing_field',
          collection: 'faqs',
          item: faq.id,
          field: 'answer',
          message: 'FAQ missing answer',
        })
      }

      if (!faq.project) {
        issues.push({
          type: 'invalid_relationship',
          collection: 'faqs',
          item: faq.id,
          field: 'project',
          message: 'FAQ missing project relationship',
        })
      }
    }

    console.log(`  ✓ Checked ${faqs.length} FAQs`)

    // Test Posts
    console.log('Testing Posts...')
    const posts = await listPayloadItems('posts')

    for (const post of posts) {
      if (!post.projects || !Array.isArray(post.projects) || post.projects.length === 0) {
        issues.push({
          type: 'invalid_relationship',
          collection: 'posts',
          item: post.id,
          field: 'projects',
          message: 'Post missing project relationships',
        })
      }
    }

    console.log(`  ✓ Checked ${posts.length} posts`)

    // Print results
    console.log('\n📊 Integrity Test Results:\n')

    if (issues.length === 0) {
      console.log('✅ All data integrity checks passed!')
      console.log('\n✓ All required fields present')
      console.log('✓ All images linked')
      console.log('✓ All relationships valid')
      console.log('✓ All slugs properly formatted')
    } else {
      console.log(`⚠️  Found ${issues.length} integrity issues:\n`)

      const byType = issues.reduce((acc, issue) => {
        acc[issue.type] = (acc[issue.type] || 0) + 1
        return acc
      }, {} as Record<string, number>)

      console.log('Issues by type:')
      Object.entries(byType).forEach(([type, count]) => {
        console.log(`  ${type}: ${count}`)
      })

      console.log('\nDetailed issues:')
      issues.slice(0, 20).forEach((issue, index) => {
        console.log(`  ${index + 1}. [${issue.collection}] ${issue.item}: ${issue.message}`)
      })

      if (issues.length > 20) {
        console.log(`  ... and ${issues.length - 20} more issues`)
      }
    }

    // Summary statistics
    console.log('\n📈 Summary:')
    console.log(`   Projects: ${projects.length} (${projects.filter(p => p.coverImage).length} with images)`)
    console.log(`   Contributors: ${contributors.length} (${contributors.filter(c => c.profilePicture).length} with images)`)
    console.log(`   FAQs: ${faqs.length}`)
    console.log(`   Posts: ${posts.length}`)
    console.log(`   Integrity issues: ${issues.length}`)

  } catch (error: any) {
    console.error('❌ Integrity test failed:', error.message)
    if (error.response) {
      console.error('   Response:', error.response.status, error.response.statusText)
    }
    process.exit(1)
  }
}

testDataIntegrity()
