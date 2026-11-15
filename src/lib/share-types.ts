export interface ShareWindow {
  id: string
  name: string
}

export type ShareMaterial =
  | { kind: 'text'; text: string; occurredAt: string }
  | { kind: 'image'; jpegBase64: string; occurredAt: string }
  | { kind: 'audio'; oggBase64: string; samples: number; occurredAt: string }
