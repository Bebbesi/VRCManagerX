const IMAGE_SCHEME = 'vrcmx-img'

function base64Url(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Profile pictures are proxied through the main process (auth + cache). */
export function imageSrc(url: string | undefined): string | undefined {
  if (!url || !url.startsWith('https://')) return undefined
  if (__UI_PREVIEW__) return undefined
  return `${IMAGE_SCHEME}://img/${base64Url(url)}`
}

export function timeOfDay(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
}

export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })
}

export function dateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium', hour12: false })
}

export function relativeTime(iso: string | undefined, now = Date.now()): string {
  if (!iso) return 'never'
  const diff = Math.round((now - Date.parse(iso)) / 1000)
  if (diff < 0) {
    const ahead = -diff
    if (ahead < 60) return `in ${ahead}s`
    if (ahead < 3600) return `in ${Math.ceil(ahead / 60)} min`
    return `in ${Math.round(ahead / 3600)} h`
  }
  if (diff < 10) return 'just now'
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`
  if (diff < 7 * 86400) return `${Math.floor(diff / 86400)} d ago`
  return shortDate(iso)
}

const STATUS_LABELS: Record<string, string> = {
  'ask me': 'Ask Me',
  'join me': 'Join Me',
  active: 'Online',
  busy: 'Do Not Disturb',
  offline: 'Offline',
  unknown: 'Unknown'
}

export function statusLabel(status: string | undefined): string {
  return STATUS_LABELS[status ?? 'unknown'] ?? status ?? 'Unknown'
}

export function statusTone(status: string | undefined): 'success' | 'warning' | 'danger' | 'info' | '' {
  switch (status) {
    case 'join me':
      return 'info'
    case 'active':
      return 'success'
    case 'ask me':
      return 'warning'
    case 'busy':
      return 'danger'
    default:
      return ''
  }
}

export function initials(name: string): string {
  const parts = name.trim().split(/[\s_.-]+/).filter(Boolean)
  const first = parts[0]?.[0] ?? '?'
  const second = parts.length > 1 ? (parts[1]?.[0] ?? '') : (parts[0]?.[1] ?? '')
  return (first + second).toUpperCase()
}

export function colorFor(seed: string): string {
  let hash = 0
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0
  const hue = Math.abs(hash) % 360
  return `linear-gradient(140deg, hsl(${hue} 62% 58%), hsl(${(hue + 40) % 360} 58% 44%))`
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
