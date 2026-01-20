/**
 * Analyze all projects in Webflow to see what we're filtering out
 * 
 * Usage:
 *   cd litecoin-fund-cms
 *   npx tsx scripts/analyze-webflow-projects.ts
 */

import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'
import axios from 'axios'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
dotenv.config({ path: path.resolve(__dirname, '../.env') })

const WEBFLOW_API_TOKEN = process.env.WEBFLOW_API_TOKEN

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

interface WebflowProject {
  id: string
  slug: string
  isDraft: boolean
  isArchived: boolean
  fieldData: {
    name: string
    slug?: string
    hidden?: boolean
    status?: string
    'project-type'?: string
  }
}

async function main() {
  console.log('🔍 Analyzing Webflow Projects...\n')

  if (!WEBFLOW_API_TOKEN) {
    console.error('❌ WEBFLOW_API_TOKEN not configured')
    process.exit(1)
  }

  const projectsCollectionId = process.env.WEBFLOW_COLLECTION_ID_PROJECTS

  if (!projectsCollectionId) {
    console.error('❌ WEBFLOW_COLLECTION_ID_PROJECTS not configured')
    process.exit(1)
  }

  const client = createWebflowClient(WEBFLOW_API_TOKEN)

  // Get all projects
  console.log('📥 Fetching all projects from Webflow...')
  const allProjects = await listCollectionItems<WebflowProject>(
    client,
    projectsCollectionId
  )

  console.log(`\n📊 Total Projects in Webflow: ${allProjects.length}\n`)

  // Categorize projects
  const published = allProjects.filter((p) => !p.isDraft && !p.isArchived && !p.fieldData.hidden)
  const drafts = allProjects.filter((p) => p.isDraft && !p.isArchived)
  const archived = allProjects.filter((p) => p.isArchived)
  const hidden = allProjects.filter((p) => !p.isDraft && !p.isArchived && p.fieldData.hidden)
  const draftAndHidden = allProjects.filter((p) => p.isDraft && p.fieldData.hidden)
  const archivedAndHidden = allProjects.filter((p) => p.isArchived && p.fieldData.hidden)

  console.log('📋 Project Breakdown:')
  console.log(`   ✅ Published (not draft, not archived, not hidden): ${published.length}`)
  console.log(`   📝 Drafts: ${drafts.length}`)
  console.log(`   📦 Archived: ${archived.length}`)
  console.log(`   👁️  Hidden (published but hidden): ${hidden.length}`)
  console.log(`   📝👁️  Draft + Hidden: ${draftAndHidden.length}`)
  console.log(`   📦👁️  Archived + Hidden: ${archivedAndHidden.length}`)

  // Show projects by status
  const byStatus = new Map<string, number>()
  allProjects.forEach((p) => {
    const status = p.fieldData.status || 'no-status'
    byStatus.set(status, (byStatus.get(status) || 0) + 1)
  })

  if (byStatus.size > 0) {
    console.log(`\n📊 Projects by Status:`)
    Array.from(byStatus.entries())
      .sort((a, b) => b[1] - a[1])
      .forEach(([status, count]) => {
        const statusProjects = allProjects.filter((p) => (p.fieldData.status || 'no-status') === status)
        const publishedInStatus = statusProjects.filter((p) => !p.isDraft && !p.isArchived && !p.fieldData.hidden).length
        const draftsInStatus = statusProjects.filter((p) => p.isDraft).length
        const archivedInStatus = statusProjects.filter((p) => p.isArchived).length
        const hiddenInStatus = statusProjects.filter((p) => !p.isDraft && !p.isArchived && p.fieldData.hidden).length
        console.log(`   "${status}": ${count} total (${publishedInStatus} published, ${draftsInStatus} drafts, ${archivedInStatus} archived, ${hiddenInStatus} hidden)`)
      })
  }

  // Show projects by type
  const byType = new Map<string, number>()
  allProjects.forEach((p) => {
    const type = p.fieldData['project-type'] || 'no-type'
    byType.set(type, (byType.get(type) || 0) + 1)
  })

  if (byType.size > 0) {
    console.log(`\n📊 Projects by Type:`)
    Array.from(byType.entries())
      .sort((a, b) => b[1] - a[1])
      .forEach(([type, count]) => {
        console.log(`   "${type}": ${count}`)
      })
  }

  // List all projects
  console.log(`\n📋 All Projects (${allProjects.length}):`)
  allProjects
    .sort((a, b) => a.fieldData.name.localeCompare(b.fieldData.name))
    .forEach((project, i) => {
      const flags = []
      if (project.isDraft) flags.push('DRAFT')
      if (project.isArchived) flags.push('ARCHIVED')
      if (project.fieldData.hidden) flags.push('HIDDEN')
      const flagStr = flags.length > 0 ? ` [${flags.join(', ')}]` : ''
      const status = project.fieldData.status ? ` (${project.fieldData.status})` : ''
      console.log(`   ${i + 1}. ${project.fieldData.name}${status}${flagStr}`)
    })

  // Show what we're currently filtering
  console.log(`\n🔍 Current Filtering Logic:`)
  console.log(`   Filters OUT:`)
  console.log(`     - Draft projects (isDraft = true): ${drafts.length}`)
  console.log(`     - Archived projects (isArchived = true): ${archived.length}`)
  console.log(`     - Hidden projects (hidden = true): ${hidden.length}`)
  console.log(`\n   Includes:`)
  console.log(`     - Published projects: ${published.length}`)

  // Check if we're missing projects that might be "Project Builders"
  const maybeProjectBuilders = allProjects.filter(
    (p) => !p.isDraft || !p.isArchived
  )
  console.log(`\n💡 Potential "Project Builders" (all non-archived): ${maybeProjectBuilders.length}`)

  const nonDraftProjects = allProjects.filter((p) => !p.isDraft)
  console.log(`💡 All non-draft projects: ${nonDraftProjects.length}`)

  const allNonHidden = allProjects.filter((p) => !p.fieldData.hidden)
  console.log(`💡 All non-hidden projects: ${allNonHidden.length}`)

  console.log(`\n✅ Analysis complete!`)
}

main().catch((error) => {
  console.error('❌ Error:', error.message)
  if (error.response) {
    console.error('   Response:', error.response.status, error.response.statusText)
    console.error('   Data:', JSON.stringify(error.response.data, null, 2))
  }
  process.exit(1)
})
