import { ShieldCheck } from 'lucide-react'

export function BrandMark({ size = 36 }: { size?: number }) {
  return (
    <div className="brand-mark" style={{ width: size, height: size, borderRadius: size * 0.3 }}>
      <ShieldCheck size={size * 0.55} strokeWidth={2.2} />
    </div>
  )
}
