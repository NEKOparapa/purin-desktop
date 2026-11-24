import { useCallback, useEffect, useRef, useState } from 'react'
import { LoaderCircle, Mic, Square, X } from 'lucide-react'
import { speechWav } from '@/lib/chat-media'

type Phase = 'idle' | 'requesting' | 'recording' | 'transcribing'

export function VoiceInput({
  revision,
  transcribe,
  disabledReason,
  onText,
  onBusy,
  onError,
}: {
  revision: number
  transcribe: (audio: ArrayBuffer, revision: number) => Promise<string>
  disabledReason?: string
  onText: (text: string) => void
  onBusy: (busy: boolean) => void
  onError: (error: string) => void
}) {
  const [phase, setPhase] = useState<Phase>('idle')
  const generation = useRef(0)
  const dispose = useRef<() => void>(() => {})
  const finish = useRef<() => void>(() => {})
  const cancel = useCallback(() => {
    generation.current++
    dispose.current()
    dispose.current = () => {}
    finish.current = () => {}
    setPhase('idle')
    onBusy(false)
  }, [onBusy])

  useEffect(() => {
    function stopWhenHidden() {
      if (document.hidden) cancel()
    }
    document.addEventListener('visibilitychange', stopWhenHidden)
    return () => {
      document.removeEventListener('visibilitychange', stopWhenHidden)
      cancel()
    }
  }, [cancel, revision])

  async function record() {
    const version = ++generation.current
    const active = () => generation.current === version
    setPhase('requesting')
    onBusy(true)
    onError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true },
        video: false,
      })
      const release = () => stream.getTracks().forEach((track) => track.stop())
      if (!active()) {
        release()
        return
      }
      dispose.current = release
      const recorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus',
      })
      const chunks: Blob[] = []
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data)
      }
      finish.current = () => {
        if (recorder.state === 'recording') recorder.stop()
      }
      const timer = window.setTimeout(finish.current, 118000)
      dispose.current = () => {
        clearTimeout(timer)
        finish.current()
        release()
      }
      recorder.onerror = () => {
        if (active()) {
          cancel()
          onError('录音中断，请检查麦克风后重试。')
        }
      }
      recorder.onstop = async () => {
        clearTimeout(timer)
        release()
        if (!active()) return
        setPhase('transcribing')
        try {
          const wav = await speechWav(
            new Blob(chunks, { type: recorder.mimeType }),
          )
          if (!active()) return
          const text = await transcribe(wav, revision)
          if (!active()) return
          if (text.trim()) onText(text.trim())
          else onError('没有识别到语音，请再试一次。')
        } catch (error) {
          if (active())
            onError(
              error instanceof Error
                ? '语音转写失败：' + error.message.replace(/^.*?Error: /, '')
                : '语音转写失败',
            )
        } finally {
          if (active()) {
            dispose.current = () => {}
            finish.current = () => {}
            setPhase('idle')
            onBusy(false)
          }
        }
      }
      stream.getAudioTracks()[0].onended = finish.current
      recorder.start()
      setPhase('recording')
    } catch (error) {
      if (!active()) return
      cancel()
      onError(
        error instanceof DOMException && error.name === 'NotAllowedError'
          ? '无法访问麦克风，请在系统隐私设置中允许 Wintermute 使用麦克风。'
          : '无法开始录音，请检查麦克风连接。',
      )
    }
  }

  const label = {
    idle: '语音输入',
    requesting: '等待麦克风权限',
    recording: '结束录音并转写',
    transcribing: '正在转写',
  }[phase]
  return (
    <>
      {phase !== 'idle' && (
        <span className="voice-state" role="status">
          {phase === 'recording' ? '正在录音' : label}
          <button type="button" aria-label="取消语音输入" onClick={cancel}>
            <X size={14} />
          </button>
        </span>
      )}
      <button
        type="button"
        className="composer-tool"
        title={disabledReason ?? label}
        aria-label={label}
        disabled={!!disabledReason || phase === 'requesting' || phase === 'transcribing'}
        onClick={() =>
          phase === 'recording' ? finish.current() : void record()
        }
      >
        {phase === 'recording' ? (
          <Square size={16} fill="currentColor" />
        ) : phase === 'idle' ? (
          <Mic size={19} />
        ) : (
          <LoaderCircle size={18} />
        )}
      </button>
    </>
  )
}
