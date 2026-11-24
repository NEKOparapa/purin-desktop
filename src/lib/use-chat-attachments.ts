import { useRef, useState } from 'react'
import { droppedChatFiles, maxAttachments, prepareAttachment, type DraftAttachment } from './chat-media'
import type { ChatAttachments, UploadChatFile } from './desktop'

export function useChatAttachments() {
  const [attachments, setAttachments] = useState<DraftAttachment[]>([])
  const [readingFiles, setReadingFiles] = useState(false)
  const [uploading, setUploading] = useState('')
  const reading = useRef(false)

  async function addFiles(selection: File[] | DataTransfer) {
    if (reading.current) return false
    reading.current = true
    setReadingFiles(true)
    try {
      const files = Array.isArray(selection) ? selection : await droppedChatFiles(selection)
      if (!files.length) return false
      if (files.length + attachments.length > maxAttachments)
        throw new Error(`每条消息最多可添加 ${maxAttachments} 个附件。`)
      const added: DraftAttachment[] = []
      for (const file of files) added.push(await prepareAttachment(file))
      setAttachments(current => [...current, ...added])
      return true
    } finally {
      reading.current = false
      setReadingFiles(false)
    }
  }

  async function prepareMessage(upload: UploadChatFile, revision?: number): Promise<ChatAttachments> {
    const images = attachments.filter(item => item.kind === 'image')
    const documents = []
    try {
      for (const item of attachments) {
        if (item.kind !== 'file') continue
        let ref = item.uploaded
        if (!ref) {
          if (revision === undefined) throw new Error('设备连接已更改')
          setUploading(item.name)
          const uploaded = await upload(item.name, await item.file.arrayBuffer(), revision)
          setAttachments(current => current.map(a => a.id === item.id ? { ...item, uploaded } : a))
          ref = uploaded
        }
        documents.push(ref)
      }
      return { images: images.map(a => a.url), documents, imageNames: images.map(a => a.name) }
    } finally {
      setUploading('')
    }
  }

  return {
    attachments, readingFiles, uploading, addFiles, prepareMessage,
    removeAttachment: (id: string) => setAttachments(current => current.filter(a => a.id !== id)),
    clearAttachments: () => setAttachments([]),
  }
}
