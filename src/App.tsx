import { useState } from 'react'
import {
  ArrowRight,
  ArrowUp,
  AudioLines,
  Battery,
  Bell,
  BookOpen,
  Check,
  ChevronRight,
  CircleHelp,
  Cpu,
  Headphones,
  House,
  Layers,
  MessageSquare,
  Monitor,
  Plus,
  Search,
  Settings2,
  Sparkles,
  Wifi,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { memories, devices } from '@/data/demo'
import './App.css'

type Page = 'home' | 'memories' | 'devices'
type Detail = { title: string; description: string; body: string }
function Mark({ small = false }: { small?: boolean }) {
  return (
    <span className={`brand-mark ${small ? 'small' : ''}`} aria-hidden="true">
      <AudioLines />
    </span>
  )
}
function Waveform() {
  return (
    <div className="waveform" aria-hidden="true">
      {Array.from({ length: 58 }, (_, i) => (
        <i
          key={i}
          style={{
            height: `${10 + Math.abs(Math.sin(i * 1.9) * Math.cos(i * 0.19)) * 78}%`,
            opacity: 0.25 + Math.sin(i * 0.13) ** 2 * 0.75,
          }}
        />
      ))}
    </div>
  )
}

export default function App() {
  const [page, setPage] = useState<Page>('home')
  const [detail, setDetail] = useState<Detail | null>(null)
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState('')
  const [messages, setMessages] = useState<{ role: string; text: string }[]>([])
  const [chatOpen, setChatOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const [filter, setFilter] = useState('全部')
  const pageNames = { home: '主页', memories: '记忆空间', devices: '我的设备' }
  const filtered = memories.filter(
    (m) =>
      (filter === '全部' || m.category === filter) &&
      `${m.title}${m.summary}`.includes(query.trim()),
  )
  function send(text = draft) {
    if (!text.trim()) return
    setMessages((previous) => [
      ...previous,
      { role: '你', text: text.trim() },
      {
        role: 'Wintermute · 模拟回复',
        text: '我已经记下了。在这份演示中，你可以查看今天的 3 条记忆切片，以及随身录音设备的示例状态。连接 Wintermute 服务后，我们就可以继续真正的对话。',
      },
    ])
    setDraft('')
    setChatOpen(true)
  }
  function newChat() {
    setMessages([])
    setChatOpen(true)
  }
  function showSettings() {
    setDetail({
      title: '关于这个空间',
      description: 'Wintermute · Desktop demo 0.1.0',
      body: '你的个人 AI 执事。当前页面使用本地示例数据，对话不会发送到服务器，也不会在关闭应用后保存。设备连接、音频上传和长期记忆将在后续版本接入。',
    })
  }
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault()
            setPage('home')
          }}
        >
          <Mark />
          <span>
            Wintermute<span className="brand-sub">PERSONAL COMPANION</span>
          </span>
        </a>
        <Button className="new-chat" onClick={newChat}>
          <Plus size={16} /> 开启新对话{' '}
          <MessageSquare size={13} className="key-hint" />
        </Button>
        <p className="nav-label">你的空间</p>
        <nav aria-label="主导航">
          {(
            [
              { id: 'home', icon: House, label: '主页' },
              { id: 'memories', icon: Layers, label: '记忆空间' },
              { id: 'devices', icon: Monitor, label: '我的设备' },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              aria-label={item.label}
              className={`nav-item ${page === item.id ? 'active' : ''}`}
              onClick={() => setPage(item.id)}
              aria-current={page === item.id ? 'page' : undefined}
            >
              <item.icon size={18} />
              <span>{item.label}</span>
              {item.id === 'memories' && <span className="nav-count">03</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-history">
          <p className="nav-label">
            最近对话 <span>示例</span>
          </p>
          {[
            '关于理想中的工作节奏',
            '一些还没成形的想法',
            '周末，去山里走走',
          ].map((title) => (
            <button
              key={title}
              onClick={() =>
                setDetail({
                  title,
                  description: '最近对话 · 示例记录',
                  body: '那些随口说出的想法，也值得被认真记住。这是一条用于展示对话列表的示例，暂未连接历史会话服务。',
                })
              }
            >
              <MessageSquare size={14} />
              {title}
            </button>
          ))}
        </div>
        <div className="sidebar-bottom">
          <div className="local-status">
            <span className="status-dot" />
            本地演示空间<Badge variant="outline">DEMO</Badge>
          </div>
          <button className="profile" onClick={showSettings}>
            <span className="avatar">S</span>
            <span>
              Su<small>个人空间</small>
            </span>
            <Settings2 size={17} />
          </button>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            个人空间 <ChevronRight size={14} />
            <span>{pageNames[page]}</span>
          </div>
          <div className="topbar-actions">
            <span className="demo-label">示例数据</span>
            <Button
              variant="ghost"
              size="icon"
              aria-label="查看通知"
              onClick={() =>
                setDetail({
                  title: '一切都已整理妥当',
                  description: '通知中心 · 示例',
                  body: '今天的 3 条记忆切片已整理完成。当前为静态演示，尚未连接真实通知。',
                })
              }
            >
              <Bell size={17} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="关于 Wintermute"
              onClick={showSettings}
            >
              <CircleHelp size={17} />
            </Button>
          </div>
        </header>
        <main className="main-layout">
          <section className="main-column">
            <div className="page-heading">
              <p className="eyebrow">YOUR DAY, A LITTLE CLEARER</p>
              <h1>
                {page === 'home' ? '慢慢来，我一直在。' : pageNames[page]}
              </h1>
              <p>
                {page === 'home'
                  ? '把琐碎交给我，把注意力留给真正重要的事。'
                  : page === 'memories'
                    ? '让每一个片刻，都有迹可循。'
                    : '无论在哪里，都能接续你的日常。'}
              </p>
            </div>
            {page === 'home' && (
              <>
                <section className="hero-card">
                  <div className="hero-copy">
                    <Badge variant="outline">
                      <span className="status-dot" /> WINTERMUTE / 待命中
                    </Badge>
                    <h2>
                      记住日常，
                      <br />
                      理解独一无二的你。
                    </h2>
                    <p>
                      从一句随想，到一段长谈。
                      <br />
                      那些重要的小事，我会替你留意。
                    </p>
                    <Button onClick={newChat}>
                      聊一聊今天 <ArrowRight size={16} />
                    </Button>
                  </div>
                  <div className="signal-art">
                    <div className="orbit orbit-1" />
                    <div className="orbit orbit-2" />
                    <div className="orbit orbit-3" />
                    <Waveform />
                    <span className="signal-caption">A QUIET PRESENCE.</span>
                    <span className="signal-cross">+</span>
                  </div>
                </section>
                <div className="stats-row">
                  <div>
                    <span>
                      <Layers size={15} /> 今日记忆
                    </span>
                    <strong>
                      03<small>条切片</small>
                    </strong>
                  </div>
                  <div>
                    <span>
                      <Headphones size={15} /> 聆听时长
                    </span>
                    <strong>
                      42<small>分钟</small>
                    </strong>
                  </div>
                  <div>
                    <span>
                      <Cpu size={15} /> 已连接设备
                    </span>
                    <strong>
                      02<small>台 · 示例</small>
                    </strong>
                  </div>
                </div>
              </>
            )}
            {page !== 'devices' && (
              <section className="memories-section">
                <div className="section-title">
                  <h2>
                    {page === 'home' ? '今天，值得记住' : '记忆切片'}
                    <span>03</span>
                  </h2>
                  {page === 'home' && (
                    <button onClick={() => setPage('memories')}>
                      全部记忆 <ArrowRight size={14} />
                    </button>
                  )}
                </div>
                {page === 'memories' && (
                  <div className="memory-tools">
                    <label className="search-box">
                      <Search size={16} />
                      <input
                        aria-label="搜索记忆"
                        placeholder="搜索你的记忆…"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                    </label>
                    <div className="filters">
                      {['全部', '语音', '对话'].map((value) => (
                        <Button
                          size="sm"
                          variant={filter === value ? 'secondary' : 'ghost'}
                          key={value}
                          onClick={() => setFilter(value)}
                          aria-pressed={filter === value}
                        >
                          {value}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}
                <div className="memory-list">
                  {(page === 'home' ? memories : filtered).map((memory) => (
                    <button
                      className="memory-card"
                      key={memory.title}
                      onClick={() =>
                        setDetail({
                          title: memory.title,
                          description: `${memory.time} · ${memory.category} · 示例记忆`,
                          body: memory.detail,
                        })
                      }
                    >
                      <span
                        className={`memory-icon ${memory.category === '对话' ? 'amber' : ''}`}
                      >
                        {memory.category === '语音' ? (
                          <AudioLines size={20} />
                        ) : (
                          <MessageSquare size={19} />
                        )}
                      </span>
                      <span className="memory-content">
                        <span className="memory-meta">
                          {memory.time}
                          <i />
                          {memory.source}
                        </span>
                        <strong>{memory.title}</strong>
                        <span className="memory-summary">{memory.summary}</span>
                        <span className="memory-tags">
                          {memory.tags.map((tag) => (
                            <span key={tag}># {tag}</span>
                          ))}
                        </span>
                      </span>
                      <ChevronRight size={17} className="memory-arrow" />
                    </button>
                  ))}
                  {filtered.length === 0 && page === 'memories' && (
                    <div className="empty-state">
                      <Search />
                      <h3>没有找到相关记忆</h3>
                      <p>换个关键词，或选择其他类型。</p>
                    </div>
                  )}
                </div>
              </section>
            )}
            {page === 'devices' && (
              <section className="device-grid">
                {devices.map((device, i) => (
                  <button
                    className="device-card"
                    key={device.name}
                    onClick={() =>
                      setDetail({
                        title: device.name,
                        description: '设备详情 · 模拟状态',
                        body: device.detail,
                      })
                    }
                  >
                    <span className="device-art">
                      {i === 0 ? (
                        <AudioLines size={42} />
                      ) : (
                        <Monitor size={42} />
                      )}
                    </span>
                    <Badge variant="outline">
                      <span className="status-dot" />
                      示例在线
                    </Badge>
                    <h2>{device.name}</h2>
                    <p>{device.description}</p>
                    <div className="device-footer">
                      <span>{device.status}</span>
                      <ArrowRight size={16} />
                    </div>
                  </button>
                ))}
                <Button
                  variant="outline"
                  className="add-device"
                  onClick={() =>
                    setDetail({
                      title: '让日常保持连接',
                      description: '添加设备',
                      body: '设备配对功能将在后续版本开放。当前只展示示例状态，不会搜索或连接真实设备。',
                    })
                  }
                >
                  <Plus size={18} /> 添加新设备
                </Button>
              </section>
            )}
            <footer className="main-footer">
              <span className="status-dot muted" />
              一个逐渐理解你的个人 AI 执事。<span>WINTERMUTE · 0.1</span>
            </footer>
          </section>
          <aside className="context-column">
            <div className="date-block">
              <span>OCTOBER 31 · DEMO</span>
              <strong>
                星期六 <span>十月的最后一天</span>
              </strong>
              <p>给自己一点留白。</p>
            </div>
            <div className="context-card">
              <div className="section-title">
                <h2>
                  <Sparkles size={16} /> 今日简报
                </h2>
                <Badge variant="outline">示例</Badge>
              </div>
              <p className="brief-intro">今天的你，正在让想法落地。</p>
              <ul className="brief-list">
                <li>为个人 AI 执事梳理了新的方向。</li>
                <li>记录了一个关于工作与生活边界的想法。</li>
                <li>给周末留了一段不被打扰的时间。</li>
              </ul>
              <Button
                variant="ghost"
                className="brief-button"
                onClick={() => send('帮我回顾一下今天')}
              >
                和我一起回顾 <ArrowRight size={15} />
              </Button>
            </div>
            <div className="context-card device-mini">
              <div className="section-title">
                <h2>身边的设备</h2>
                <button
                  aria-label="查看全部设备"
                  onClick={() => setPage('devices')}
                >
                  <ArrowRight size={16} />
                </button>
              </div>
              <div className="mini-device">
                <span className="mini-device-icon">
                  <AudioLines size={25} />
                </span>
                <div>
                  <strong>Wintermute Clip</strong>
                  <span>
                    <span className="status-dot" />
                    示例在线
                  </span>
                </div>
              </div>
              <div className="device-metrics">
                <span>
                  <Battery size={16} /> 86%
                </span>
                <span>
                  <Wifi size={14} /> 已连接
                </span>
              </div>
              <div className="battery-track">
                <i />
              </div>
              <p>最近同步于 14:32 · 示例状态</p>
            </div>
            <div className="quiet-note">
              <BookOpen size={18} />
              <p>
                “不必记住所有事情。
                <br />
                只要记住，对你重要的。”
              </p>
              <span>MADE FOR YOUR EVERYDAY</span>
            </div>
          </aside>
        </main>
        <div className="composer-dock">
          <div className="composer-inner">
            <form
              className="composer"
              onSubmit={(e) => {
                e.preventDefault()
                send()
              }}
            >
              <Mark small />
              <input
                aria-label="发送给 Wintermute"
                placeholder="有什么想和我说的？"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
              <Button
                variant="ghost"
                type="button"
                size="icon"
                aria-label="语音输入说明"
                onClick={() =>
                  setNotice(
                    '语音输入将在后续版本开放。现在可以输入文字体验模拟对话。',
                  )
                }
              >
                <AudioLines size={19} />
              </Button>
              <Button
                className="send-button"
                type="submit"
                size="icon"
                aria-label="发送消息"
                disabled={!draft.trim()}
              >
                <ArrowUp size={18} />
              </Button>
            </form>
            <span className="composer-caption">
              此刻的想法，也值得被记住。<span>本地演示 · 未连接服务</span>
            </span>
            {notice && (
              <div className="inline-notice" role="status">
                {notice}
                <button aria-label="关闭提示" onClick={() => setNotice('')}>
                  <X size={14} />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      <Dialog
        open={!!detail}
        onOpenChange={(open) => {
          if (!open) setDetail(null)
        }}
      >
        <DialogContent className="detail-dialog">
          <DialogHeader>
            <DialogTitle>{detail?.title}</DialogTitle>
            <DialogDescription>{detail?.description}</DialogDescription>
          </DialogHeader>
          <p className="detail-body">{detail?.body}</p>
          <Button onClick={() => setDetail(null)}>
            <Check size={16} /> 知道了
          </Button>
        </DialogContent>
      </Dialog>
      <Dialog open={chatOpen} onOpenChange={setChatOpen}>
        <DialogContent className="chat-dialog">
          <DialogHeader>
            <DialogTitle>和 Wintermute 聊一聊</DialogTitle>
            <DialogDescription>本地模拟对话 · 关闭应用后清空</DialogDescription>
          </DialogHeader>
          <div className="chat-history" role="log" aria-live="polite">
            {messages.length === 0 ? (
              <div className="empty-state">
                <Mark />
                <h3>我在这里，听你说。</h3>
                <p>可以说说今天，也可以只是一个突然的想法。</p>
                <Button
                  variant="outline"
                  onClick={() => send('帮我回顾一下今天')}
                >
                  帮我回顾一下今天 <ArrowRight size={15} />
                </Button>
              </div>
            ) : (
              messages.map((message, i) => (
                <div
                  key={i}
                  className={`chat-message ${message.role === '你' ? 'user' : ''}`}
                >
                  <span>{message.role}</span>
                  <p>{message.text}</p>
                </div>
              ))
            )}
          </div>
          <form
            className="chat-form"
            onSubmit={(e) => {
              e.preventDefault()
              send()
            }}
          >
            <input
              aria-label="对话消息"
              placeholder="继续聊聊…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <Button
              type="submit"
              size="icon"
              aria-label="发送对话消息"
              disabled={!draft.trim()}
            >
              <ArrowUp size={18} />
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
