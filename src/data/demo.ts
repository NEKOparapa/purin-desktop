// Local fixtures only; no service or hardware is contacted.
export const memories = [
  {
    title: '让 AI 成为日常里安静的陪伴',
    time: '14:32',
    source: '随身录音 · 18 分钟',
    category: '语音',
    summary: '比起更多的功能，更希望它能理解上下文，在恰当的时候出现。',
    tags: ['产品灵感', 'Wintermute'],
    detail:
      '下午散步时想到，理想中的 AI 执事不需要一直提醒自己它的存在。它应该记得之前聊过的事，理解那些没说完整的想法。\n\n下一步：先把跨设备的主页做出来，让想法有一个可以触碰的起点。\n\n这是一条示例记忆。',
  },
  {
    title: '专注，也需要一些边界',
    time: '11:06',
    source: '桌面对话',
    category: '对话',
    summary: '尝试把上午留给深度工作，消息和琐事放到下午集中处理。',
    tags: ['生活方式', '专注'],
    detail:
      '给自己留出一段完整的时间，只做一件重要的事。暂时放下消息提醒，在下午统一处理琐事。\n\n这是一条示例记忆，尚未创建真实日程。',
  },
  {
    title: '周末的小小出逃计划',
    time: '09:18',
    source: '随身录音 · 24 分钟',
    category: '语音',
    summary: '找一条安静的山间小路，带上相机，不急着抵达。',
    tags: ['周末计划', '随想'],
    detail:
      '想在周末去附近的山里走走。带上相机和水，不设定一定要到达的目的地，只是看看沿途的风景。\n\n这是一条示例记忆。',
  },
]
export const devices = [
  {
    name: 'Wintermute Clip',
    description: '随身录音设备 · ESP32',
    status: '电量 86% · Wi-Fi',
    detail:
      '模拟设备状态：电量 86%，今天已同步 2 段录音，共 42 分钟。\n\n当前客户端没有连接硬件，也不会启动录音或上传音频。',
  },
  {
    name: 'Wintermute Desktop',
    description: '桌面伴侣 · Windows / macOS',
    status: '当前客户端 · 本地演示',
    detail:
      'React + TypeScript + shadcn/ui，通过 Electron 运行。当前为离线主页演示，所有状态与记忆均为本地示例。',
  },
]
