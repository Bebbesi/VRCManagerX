import { join } from 'node:path'
import { app } from 'electron'

export function dataPaths() {
  const root = app.getPath('userData')
  return {
    root,
    settings: join(root, 'settings.json'),
    lists: join(root, 'lists.json'),
    stats: join(root, 'stats.json'),
    processed: join(root, 'processed.json'),
    session: join(root, 'session.bin'),
    activity: join(root, 'logs', 'activity.jsonl'),
    errors: join(root, 'logs', 'errors.log'),
    imageCache: join(root, 'cache', 'images')
  }
}

export type DataPaths = ReturnType<typeof dataPaths>
