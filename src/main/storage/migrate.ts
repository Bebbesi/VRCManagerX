import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** Data folder name used before the app was renamed to VRCManagerX. */
export const LEGACY_DATA_DIR_NAME = 'GoyChat Manager'

const DATA_FILES = [
  'settings.json',
  'settings.json.bak',
  'lists.json',
  'lists.json.bak',
  'stats.json',
  'stats.json.bak',
  'processed.json',
  'processed.json.bak',
  'session.bin',
  join('logs', 'activity.jsonl'),
  join('logs', 'errors.log')
]

/** Files that show the new profile already holds user data (then nothing is migrated). */
const MARKERS = ['settings.json', 'lists.json', 'stats.json', 'session.bin']

/**
 * Copies the user's data from the pre-rename folder into a fresh profile, so lists, settings,
 * statistics, logs and the signed-in session survive the rename. The old folder is left untouched.
 *
 * `Local State` is copied too: it holds the key Electron's safeStorage used to encrypt session.bin.
 * This must run synchronously at startup, before Chromium loads the profile.
 */
export function migrateLegacyData(target: string, legacy: string): string[] {
  if (target === legacy || !existsSync(legacy)) return []
  if (MARKERS.some((f) => existsSync(join(target, f)))) return []
  if (!MARKERS.some((f) => existsSync(join(legacy, f)))) return []

  const copied: string[] = []
  const copy = (rel: string, overwrite: boolean) => {
    const from = join(legacy, rel)
    const to = join(target, rel)
    if (!existsSync(from) || (!overwrite && existsSync(to))) return
    mkdirSync(dirname(to), { recursive: true })
    copyFileSync(from, to)
    copied.push(rel)
  }
  for (const rel of DATA_FILES) copy(rel, false)
  if (copied.includes('session.bin')) copy('Local State', true)
  return copied
}
