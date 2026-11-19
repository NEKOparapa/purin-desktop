import { useState } from 'react'
import type { ChatMessage } from '@/lib/desktop'
import './chat-jump-bar.css'

const previewTime = new Intl.DateTimeFormat('zh-CN', {
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

function summarize(text: string) {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > 72 ? clean.slice(0, 72) + '…' : clean
}

export function ChatJumpBar({
  items,
  activeId,
  onJump,
}: {
  items: ChatMessage[]
  activeId: string | null
  onJump: (id: string) => void
}) {
  const [hovered, setHovered] = useState<{
    message: ChatMessage
    top: number
  } | null>(null)

  if (items.length < 2) return null

  return (
    <nav className="chat-jump-bar" aria-label="对话快速跳转">
      <div
        className="chat-jump-list"
        onMouseLeave={() => setHovered(null)}
      >
        {items.map((message, index) => {
          const active = message.id === activeId
          const label = `跳转到第 ${index + 1} 条提问：${summarize(message.text)}`
          return (
            <button
              key={message.id}
              type="button"
              className="chat-jump-item"
              aria-label={label}
              aria-current={active ? 'true' : undefined}
              onClick={() => onJump(message.id)}
              onMouseEnter={(event) => {
                const bar = event.currentTarget.closest('.chat-jump-bar')
                if (!bar) return
                const barRect = bar.getBoundingClientRect()
                const itemRect = event.currentTarget.getBoundingClientRect()
                setHovered({
                  message,
                  top: itemRect.top - barRect.top + itemRect.height / 2,
                })
              }}
              onFocus={(event) => {
                const bar = event.currentTarget.closest('.chat-jump-bar')
                if (!bar) return
                const barRect = bar.getBoundingClientRect()
                const itemRect = event.currentTarget.getBoundingClientRect()
                setHovered({
                  message,
                  top: itemRect.top - barRect.top + itemRect.height / 2,
                })
              }}
              onBlur={() => setHovered(null)}
            >
              <span className="chat-jump-tick" aria-hidden="true" />
            </button>
          )
        })}
      </div>
      {hovered && (
        <div
          className="chat-jump-preview"
          style={{ top: hovered.top }}
          aria-hidden="true"
        >
          <p className="chat-jump-preview-text">
            {summarize(hovered.message.text)}
          </p>
          {hovered.message.at && Number.isFinite(Date.parse(hovered.message.at)) && (
            <time className="chat-jump-preview-time">
              {previewTime.format(Date.parse(hovered.message.at))}
            </time>
          )}
        </div>
      )}
    </nav>
  )
}
