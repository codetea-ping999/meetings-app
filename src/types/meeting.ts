export type CardCategory = '課題' | '決定' | 'アクション' | 'アイデア'
export type DiagramKind = 'stickies' | 'flow' | 'tree' | 'matrix'

export type TranscriptLine = {
  id: string
  at: string
  text: string
  source: 'audio' | 'manual'
}

export type BoardCard = {
  id: string
  category: CardCategory
  text: string
}

export type ActionItem = {
  id: string
  task: string
  owner: string
  due: string
}

export type Analysis = {
  summary: string
  minutes: string
  cards: BoardCard[]
  actions: ActionItem[]
  diagram: { kind: DiagramKind; edges: { from: string; to: string }[] }
  updatedAt: string
}

export type Meeting = {
  id: string
  title: string
  startedAt: string
  endedAt: string | null
  transcript: TranscriptLine[]
  analysis: Analysis | null
  boardSnapshot: unknown | null
  protectedShapeIds: string[]
  deletedShapeIds: string[]
}

export const EMPTY_ANALYSIS: Analysis = {
  summary: '', minutes: '', cards: [], actions: [],
  diagram: { kind: 'stickies', edges: [] }, updatedAt: '',
}
