import { useEffect, useRef, useState } from 'react'
import { Camera, Mic, Paperclip, Square, Type } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { encodeRecording, MAX_RECORDING_SECONDS } from '@/lib/opus-clip'
import type { ShareMaterial, ShareWindow } from '@/lib/share-types'
import './share-panel.css'

type Kind = ShareMaterial['kind']

function asDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('无法读取分享内容'))
    reader.onload = () => resolve(String(reader.result))
    reader.readAsDataURL(blob)
  })
}

async function previewImage(file: Blob) {
  if (file.size > 24 * 1024 * 1024) throw new Error('请选择小于 24 MiB 的截图')
  const bitmap = await createImageBitmap(file)
  try {
    const scale = Math.min(1, 1920 / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('无法生成截图预览')
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.82)
  } finally {
    bitmap.close()
  }
}

function ShareDraft({ onSaved }: { onSaved: () => void }) {
  const [kind, setKind] = useState<Kind>('text')
  const [text, setText] = useState('')
  const [windows, setWindows] = useState<ShareWindow[]>([])
  const [target, setTarget] = useState('')
  const [image, setImage] = useState('')
  const [audio, setAudio] = useState<{
    clip: Blob
    samples: number
    url: string
  } | null>(null)
  const [at, setAt] = useState('')
  const [recording, setRecording] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [busy, setBusy] = useState(false)
  const [issue, setIssue] = useState('')
  const recorder = useRef<MediaRecorder | null>(null)
  const live = useRef(true)
  const api = window.wintermute

  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
      const current = recorder.current
      if (current) {
        if (current.state === 'recording') current.stop()
        current.stream.getTracks().forEach((track) => track.stop())
      }
    }
  }, [])
  useEffect(() => {
    if (audio) return () => URL.revokeObjectURL(audio.url)
  }, [audio])
  useEffect(() => {
    if (!recording) return
    const start = Date.now()
    const timer = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - start) / 1000)
      setSeconds(elapsed)
      if (
        elapsed >= MAX_RECORDING_SECONDS &&
        recorder.current?.state === 'recording'
      )
        recorder.current.stop()
    }, 250)
    return () => clearInterval(timer)
  }, [recording])
  function describe(error: unknown) {
    return error instanceof Error
      ? error.message.replace(/^.*?Error: /, '')
      : '操作未完成，请重试'
  }
  async function run(task: () => Promise<void>) {
    setBusy(true)
    setIssue('')
    try {
      await task()
    } catch (error) {
      if (live.current) setIssue(describe(error))
    } finally {
      if (live.current) setBusy(false)
    }
  }
  function switchKind(next: Kind) {
    if (next === kind) return
    setKind(next)
    setIssue('')
    setAt('')
    setAudio(null)
    setImage('')
  }
  async function record() {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder)
      throw new Error('当前环境无法使用麦克风')
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1 },
        video: false,
      })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotAllowedError')
        throw new Error('请在系统隐私设置中允许 Wintermute 使用麦克风后重试')
      throw error
    }
    const stopTracks = () => stream.getTracks().forEach((track) => track.stop())
    if (!live.current) {
      stopTracks()
      return
    }
    try {
      const options = {
        mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=pcm')
          ? 'audio/webm;codecs=pcm'
          : 'audio/webm;codecs=opus',
      }
      const current = new MediaRecorder(stream, options)
      recorder.current = current
      const chunks: Blob[] = []
      let failed = false
      current.ondataavailable = ({ data }) => {
        if (data.size) chunks.push(data)
      }
      current.onerror = () => {
        failed = true
        stopTracks()
        if (live.current) {
          setRecording(false)
          setIssue('麦克风录音中断，请重新录制')
        }
      }
      current.onstop = async () => {
        stopTracks()
        recorder.current = null
        if (!live.current) return
        setRecording(false)
        if (failed) return
        await run(async () => {
          const clip = await encodeRecording(
            new Blob(chunks, { type: current.mimeType }),
          )
          if (live.current)
            setAudio({
              clip: clip.blob,
              samples: clip.samples,
              url: URL.createObjectURL(clip.blob),
            })
        })
      }
      current.start()
      setAt(new Date().toISOString())
      setSeconds(0)
      setAudio(null)
      setRecording(true)
    } catch (error) {
      stopTracks()
      throw error
    }
  }
  function save() {
    if (!api) return
    void run(async () => {
      const occurredAt = at || new Date().toISOString()
      let payload: ShareMaterial
      if (kind === 'text') payload = { kind, text: text.trim(), occurredAt }
      else if (kind === 'image')
        payload = { kind, jpegBase64: image.split(',')[1], occurredAt }
      else {
        if (!audio) throw new Error('请先录音')
        const encoded = await asDataUrl(audio.clip)
        if (!live.current) return
        payload = {
          kind,
          oggBase64: encoded.split(',')[1],
          samples: audio.samples,
          occurredAt,
        }
      }
      await api.shareMaterial(payload)
      if (live.current) onSaved()
    })
  }
  const ready =
    kind === 'text' ? !!text.trim() : kind === 'image' ? !!image : !!audio
  function pasteImage(event: React.ClipboardEvent) {
    if (kind !== 'image' || busy) return
    const file = Array.from(event.clipboardData.files).find((item) =>
      item.type.startsWith('image/'),
    )
    if (!file) return
    event.preventDefault()
    void run(async () => {
      const url = await previewImage(file)
      if (live.current) {
        setImage(url)
        setAt(new Date().toISOString())
      }
    })
  }
  return (
    <DialogContent className="detail-dialog share-dialog" onPaste={pasteImage}>
      <DialogHeader>
        <DialogTitle>分享素材</DialogTitle>
        <DialogDescription>
          截图和录音原件保存在切片层；活动时间线只显示文字。
        </DialogDescription>
      </DialogHeader>
      <div className="share-modes" aria-label="分享类型">
        {(
          [
            ['text', '文字', Type],
            ['image', '截图', Camera],
            ['audio', '录音', Mic],
          ] as const
        ).map(([value, name, Icon]) => (
          <button
            key={value}
            type="button"
            aria-pressed={kind === value}
            disabled={busy || recording}
            onClick={() => switchKind(value)}
          >
            <Icon size={15} />
            {name}
          </button>
        ))}
      </div>
      {kind === 'text' && (
        <label className="share-field">
          文字内容
          <textarea
            autoFocus
            value={text}
            placeholder="输入或粘贴要记住的文字"
            rows={5}
            onChange={(event) => setText(event.target.value)}
          />
        </label>
      )}
      {kind === 'image' && (
        <div className="share-field" aria-label="截图，可粘贴图片">
          <div className="share-image-tools">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  if (!api) return
                  const sources = await api.listShareWindows()
                  if (!sources.length)
                    throw new Error('没有可用窗口，可直接粘贴截图')
                  setWindows(sources)
                  setTarget(sources[0].id)
                })
              }
            >
              {windows.length ? '刷新窗口' : '选择窗口'}
            </Button>
            <span>也可以在这里粘贴截图</span>
          </div>
          {windows.length > 0 && (
            <div className="share-image-tools">
              <select
                aria-label="窗口或屏幕"
                value={target}
                onChange={(e) => {
                  setTarget(e.target.value)
                  setImage('')
                }}
              >
                {windows.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                variant="outline"
                disabled={!target || busy}
                onClick={() =>
                  void run(async () => {
                    if (!api) return
                    const url = await api.captureShareWindow(target)
                    if (live.current) {
                      setImage(url)
                      setAt(new Date().toISOString())
                    }
                  })
                }
              >
                截取预览
              </Button>
            </div>
          )}
          {image && (
            <img className="share-image" src={image} alt="待分享的截图" />
          )}
        </div>
      )}
      {kind === 'audio' && (
        <div className="share-field">
          <div className="share-record">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => {
                if (recording && recorder.current?.state === 'recording')
                  recorder.current.stop()
                else void run(record)
              }}
            >
              {recording ? <Square size={14} /> : <Mic size={14} />}
              {recording ? '停止录音' : audio ? '重新录制' : '开始录音'}
            </Button>
            <span>
              {recording
                ? '录音中 · ' +
                  Math.floor(seconds / 60) +
                  ':' +
                  String(seconds % 60).padStart(2, '0')
                : '麦克风 · 单段最多 5 分钟'}
            </span>
          </div>
          {audio && (
            <audio controls src={audio.url} aria-label="试听待分享的录音" />
          )}
        </div>
      )}
      {issue && (
        <p role="alert" className="share-error">
          {issue}
        </p>
      )}
      <Button
        className="share-submit"
        type="button"
        disabled={busy || recording || !ready}
        onClick={save}
      >
        {busy ? '处理中…' : '确认分享'}
      </Button>
    </DialogContent>
  )
}

export function SharePanel({ configured }: { configured: boolean }) {
  const [open, setOpen] = useState(false)
  const [sent, setSent] = useState(false)
  useEffect(() => {
    if (!sent) return
    const timer = window.setTimeout(() => setSent(false), 3000)
    return () => clearTimeout(timer)
  }, [sent])
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="share-trigger"
          disabled={!configured}
          title="分享素材"
          aria-label="分享素材"
        >
          <Paperclip size={17} aria-hidden="true" />
          <span aria-live="polite">{sent ? '已加入发送队列' : '分享'}</span>
        </button>
      </DialogTrigger>
      {open && (
        <ShareDraft
          onSaved={() => {
            setSent(true)
            setOpen(false)
          }}
        />
      )}
    </Dialog>
  )
}
