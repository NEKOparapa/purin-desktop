import { FileText, X } from 'lucide-react'
import type { DraftAttachment } from '@/lib/chat-media'

export function DraftAttachments({ items, sending, remove }: {
  items: DraftAttachment[]
  sending: boolean
  remove: (id: string) => void
}) {
  if (!items.length) return null
  return (
    <div className="draft-images" role="group" aria-label="待发送附件">
      {items.map(item => (
        <div key={item.id} className={'draft-attachment' + (item.kind === 'image' ? ' with-thumbnail' : '')}>
          {item.kind === 'image'
            ? <img src={item.url} alt={item.name} />
            : <FileText size={21} aria-hidden="true" />}
          <span title={item.name}>{item.name}</span>
          <button type="button" disabled={sending} aria-label={'移除 ' + item.name} onClick={() => remove(item.id)}>
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}
