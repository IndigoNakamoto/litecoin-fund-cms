/**
 * Normalize Payload media filenames on disk.
 *
 * Problem:
 * - Some migration scripts uploaded media using URL-encoded filenames (e.g. "%20").
 * - Payload's file server resolves/decodes the filename and looks for a path with spaces,
 *   so files stored on disk as "...%20..." are treated as missing.
 *
 * This script renames files under `litecoin-fund-cms/media/` by decoding any percent-escapes
 * (e.g. `%20` -> space). It will:
 * - Skip renames that would introduce path separators
 * - Skip collisions if the target filename already exists
 *
 * Usage:
 *   cd litecoin-fund-cms
 *   ./node_modules/.bin/tsx scripts/normalize-media-filenames.ts
 *
 * Dry run:
 *   ./node_modules/.bin/tsx scripts/normalize-media-filenames.ts --dry-run
 */

import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

function tryDecodeURIComponent(input: string): string {
  try {
    return decodeURIComponent(input)
  } catch {
    return input
  }
}

function multiDecode(input: string, maxPasses: number = 3): string {
  let out = input
  for (let i = 0; i < maxPasses; i++) {
    const next = tryDecodeURIComponent(out)
    if (next === out) break
    out = next
  }
  return out
}

function isSafeFilename(name: string): boolean {
  // Prevent path traversal or invalid paths after decoding.
  return !name.includes('/') && !name.includes('\\') && !name.includes('\0')
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const mediaDir = path.resolve(__dirname, '../media')

  console.log(`📁 Media dir: ${mediaDir}`)
  console.log(dryRun ? '🧪 Dry run (no changes will be made)\n' : '✍️  Renaming files...\n')

  const entries = await fs.readdir(mediaDir, { withFileTypes: true })

  let renamed = 0
  let skipped = 0

  for (const entry of entries) {
    if (!entry.isFile()) continue

    const fromName = entry.name
    const toName = multiDecode(fromName)

    if (toName === fromName) continue

    if (!isSafeFilename(toName)) {
      console.warn(`⚠️  Skip (unsafe decoded filename): "${fromName}" -> "${toName}"`)
      skipped++
      continue
    }

    const fromPath = path.join(mediaDir, fromName)
    const toPath = path.join(mediaDir, toName)

    if (await exists(toPath)) {
      console.warn(`⚠️  Skip (target exists): "${fromName}" -> "${toName}"`)
      skipped++
      continue
    }

    if (dryRun) {
      console.log(`DRY: "${fromName}" -> "${toName}"`)
      renamed++
      continue
    }

    await fs.rename(fromPath, toPath)
    console.log(`✓ "${fromName}" -> "${toName}"`)
    renamed++
  }

  console.log(`\n✅ Done. ${renamed} ${dryRun ? 'would be renamed' : 'renamed'}, ${skipped} skipped.`)
}

main().catch((err) => {
  console.error('❌ Failed:', err)
  process.exit(1)
})

