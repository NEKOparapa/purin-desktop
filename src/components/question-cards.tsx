import { t } from '@/lib/i18n'
import { useState } from 'react'
import { Check, ChevronLeft, ChevronRight, HelpCircle, Send, X } from 'lucide-react'
import type { PendingQuestion } from '../lib/desktop'
import './question-cards.css'

function QuestionCard({
  item,
  index,
  total,
  onPrev,
  onNext,
}: {
  item: PendingQuestion
  index: number
  total: number
  onPrev: () => void
  onNext: () => void
}) {
  const [selected, setSelected] = useState<string[]>([])
  const [customText, setCustomText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const showCustomInput = item.allow_custom || item.options.length === 0
  const canSubmit = !submitting && (selected.length > 0 || customText.trim().length > 0)

  function toggleOption(option: string) {
    setError('')
    if (item.multi_select) {
      setSelected((prev) =>
        prev.includes(option) ? prev.filter((o) => o !== option) : [...prev, option],
      )
    } else {
      setSelected((prev) => (prev[0] === option ? [] : [option]))
    }
  }

  async function submit() {
    if (!canSubmit) return
    setSubmitting(true)
    setError('')
    try {
      await window.purin?.answerQuestion({
        id: item.id,
        selectedOptions: selected,
        answerText: customText.trim(),
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : t('提交回答失败，请重试'))
    } finally {
      setSubmitting(false)
    }
  }

  async function dismiss() {
    if (submitting) return
    setSubmitting(true)
    setError('')
    try {
      await window.purin?.dismissQuestion(item.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('忽略提问失败，请重试'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <article className="question-card" aria-label={t('待回答提问：{0}', item.title)}>
      <header className="question-card-header">
        <div className="question-card-badge">
          <HelpCircle size={15} aria-hidden="true" />
          <span>{t('待回答提问')}</span>
          {item.multi_select && <span className="question-card-mode">{t('多选')}</span>}
        </div>
        <div className="question-card-controls">
          {total > 1 && (
            <div className="question-card-pager" aria-label={t('切换待回答提问')}>
              <button
                type="button"
                className="question-icon-btn"
                aria-label={t('上一条提问')}
                onClick={onPrev}
              >
                <ChevronLeft size={15} />
              </button>
              <span className="question-card-count">
                {index + 1} / {total}
              </span>
              <button
                type="button"
                className="question-icon-btn"
                aria-label={t('下一条提问')}
                onClick={onNext}
              >
                <ChevronRight size={15} />
              </button>
            </div>
          )}
          <button
            type="button"
            className="question-icon-btn"
            aria-label={t('忽略此提问')}
            title={t('忽略此提问')}
            disabled={submitting}
            onClick={() => void dismiss()}
          >
            <X size={15} />
          </button>
        </div>
      </header>

      <div className="question-card-body">
        <h2 className="question-card-title">{item.title}</h2>
        <p className="question-card-text">{item.question}</p>
      </div>

      {item.options.length > 0 && (
        <div
          className="question-options"
          role={item.multi_select ? 'group' : 'radiogroup'}
          aria-label={t('可选回答')}
        >
          {item.options.map((option) => {
            const active = selected.includes(option)
            return (
              <button
                key={option}
                type="button"
                className="question-option"
                data-selected={active ? 'true' : undefined}
                aria-pressed={active}
                disabled={submitting}
                onClick={() => toggleOption(option)}
              >
                {active && <Check size={14} aria-hidden="true" />}
                <span>{option}</span>
              </button>
            )
          })}
        </div>
      )}

      <div className="question-card-footer">
        {showCustomInput ? (
          <input
            type="text"
            className="question-custom-input"
            placeholder={item.options.length > 0 ? t('补充说明或输入自定义回答（可选）') : t('输入你的回答...')}
            value={customText}
            disabled={submitting}
            onChange={(e) => {
              setError('')
              setCustomText(e.target.value)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                void submit()
              }
            }}
          />
        ) : (
          <span className="question-card-hint">{t('请选择上方选项后提交')}</span>
        )}
        <button
          type="button"
          className="question-submit-btn"
          disabled={!canSubmit}
          onClick={() => void submit()}
        >
          <Send size={14} aria-hidden="true" />
          <span>{submitting ? t('提交中...') : t('提交回答')}</span>
        </button>
      </div>

      {error && (
        <p className="question-card-error" role="alert">
          {error}
        </p>
      )}
    </article>
  )
}

export function QuestionCards({ questions }: { questions: PendingQuestion[] }) {
  const [cursor, setCursor] = useState(0)
  if (!questions.length) return null
  const safeIndex = cursor >= questions.length ? 0 : cursor
  const current = questions[safeIndex]
  return (
    <section className="question-deck" aria-label={t('待回答提问卡片')}>
      <QuestionCard
        key={current.id}
        item={current}
        index={safeIndex}
        total={questions.length}
        onPrev={() => setCursor((safeIndex - 1 + questions.length) % questions.length)}
        onNext={() => setCursor((safeIndex + 1) % questions.length)}
      />
    </section>
  )
}
