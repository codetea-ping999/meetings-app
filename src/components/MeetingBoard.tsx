'use client'
import { useCallback, useEffect, useRef } from 'react'
import { createShapeId, getSnapshot, toRichText, Tldraw, type Editor, type TLEditorSnapshot } from 'tldraw'
import type { Analysis, BoardCard, DiagramKind } from '@/types/meeting'

type Props = {
  analysis: Analysis | null
  snapshot: unknown
  protectedIds: string[]
  deletedIds: string[]
  onChange: (snapshot: unknown, protectedIds: string[], deletedIds: string[]) => void
  dark: boolean
}
const noteId = (id: string) => createShapeId(`ai-${id.replace(/[^a-zA-Z0-9-]/g, '-')}`)
const arrowId = (a: string, b: string) => createShapeId(`edge-${a.replace(/[^a-zA-Z0-9-]/g, '-')}-${b.replace(/[^a-zA-Z0-9-]/g, '-')}`)
const colors: Record<BoardCard['category'], 'yellow' | 'blue' | 'green' | 'violet'> = {
  '課題': 'yellow', '決定': 'blue', 'アクション': 'green', 'アイデア': 'violet',
}

function position(card: BoardCard, index: number, kind: DiagramKind, cards: BoardCard[]) {
  if (kind === 'flow') return { x: 90 + (index % 4) * 290, y: 120 + Math.floor(index / 4) * 310 }
  if (kind === 'tree') return index === 0 ? { x: 540, y: 80 } : { x: 80 + ((index - 1) % 5) * 255, y: 360 + Math.floor((index - 1) / 5) * 300 }
  if (kind === 'matrix') {
    const categories: BoardCard['category'][] = ['課題', '決定', 'アクション', 'アイデア']
    const categoryIndex = categories.indexOf(card.category)
    const withinCategory = cards.slice(0, index).filter(c => c.category === card.category).length
    return { x: 85 + (categoryIndex % 2) * 550 + (withinCategory % 2) * 245, y: 100 + Math.floor(categoryIndex / 2) * 460 + Math.floor(withinCategory / 2) * 245 }
  }
  return { x: 85 + (index % 4) * 275, y: 100 + Math.floor(index / 4) * 275 }
}

export function MeetingBoard({ analysis, snapshot, protectedIds, deletedIds, onChange, dark }: Props) {
  const editorRef = useRef<Editor | null>(null)
  const applying = useRef(false)
  const protectedRef = useRef(new Set(protectedIds))
  const deletedRef = useRef(new Set(deletedIds))
  const callback = useRef(onChange)
  useEffect(() => { callback.current = onChange }, [onChange])
  const lastLayout = useRef<DiagramKind | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const persist = useCallback((editor: Editor) => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => callback.current(getSnapshot(editor.store), [...protectedRef.current], [...deletedRef.current]), 300)
  }, [])

  const sync = useCallback((editor: Editor, next: Analysis | null) => {
    if (!next || !next.cards.length) return
    const cards = next.cards.slice(0, 20)
    const resetLayout = lastLayout.current !== null && lastLayout.current !== next.diagram.kind
    lastLayout.current = next.diagram.kind
    applying.current = true
    try {
      for (const [i, card] of cards.entries()) {
        const id = noteId(card.id)
        if (deletedRef.current.has(id)) continue
        const shape = editor.getShape(id)
        const xy = position(card, i, next.diagram.kind, cards)
        if (!shape) {
          editor.createShape({
            id, type: 'note', x: xy.x, y: xy.y,
            props: { color: colors[card.category], labelColor: 'black', richText: toRichText(card.text), font: 'sans', size: 'm' },
          })
        } else if (!protectedRef.current.has(id)) {
          // Preserve an existing position unless the user explicitly changes diagram type.
          editor.updateShape({ id, type: 'note', ...(resetLayout ? xy : {}),
            props: { richText: toRichText(card.text), color: colors[card.category] } })
        }
      }
      // Always keep freehand user shapes. Only AI-owned edge shapes are reconciled.
      const desired = new Set<string>()
      if (next.diagram.kind === 'flow' || next.diagram.kind === 'tree') {
        const valid = new Set(cards.map(c => c.id))
        const links = next.diagram.edges.filter(e => valid.has(e.from) && valid.has(e.to) && e.from !== e.to)
        const edgeList = links.length ? links : next.diagram.kind === 'flow' ? cards.slice(1).map((c, i) => ({ from: cards[i].id, to: c.id })) : []
        for (const edge of edgeList.slice(0, 28)) {
          const from = editor.getShape(noteId(edge.from))
          const to = editor.getShape(noteId(edge.to))
          if (!from || !to) continue
          const id = arrowId(edge.from, edge.to)
          desired.add(id)
          const x = from.x + 195, y = from.y + 95
          const props = { start: { x: 0, y: 0 }, end: { x: to.x - x + 5, y: to.y - y + 95 }, arrowheadEnd: 'arrow' as const, color: 'grey' as const }
          if (editor.getShape(id)) editor.updateShape({ id, type: 'arrow', x, y, props })
          else editor.createShape({ id, type: 'arrow', x, y, props })
        }
      }
      const previousEdges = editor.getCurrentPageShapes().filter(s => s.id.startsWith('shape:edge-') && !desired.has(s.id))
      if (previousEdges.length) editor.deleteShapes(previousEdges.map(s => s.id))
    } finally {
      applying.current = false
    }
    persist(editor)
  }, [persist])

  useEffect(() => { if (editorRef.current) sync(editorRef.current, analysis) }, [analysis, sync])

  return (
    <div className="relative h-full w-full overflow-hidden rounded-xl border stroke" style={{ minHeight: 350 }}>
      <Tldraw
        snapshot={snapshot ? snapshot as TLEditorSnapshot : undefined}
        locale="ja"
        colorScheme={dark ? 'dark' : 'light'}
        licenseKey={process.env.NEXT_PUBLIC_TLDRAW_LICENSE_KEY || undefined}
        onMount={(editor) => {
          editorRef.current = editor
          const unlisten = editor.store.listen(({ changes }) => {
            if (applying.current) return
            for (const id of Object.keys(changes.removed)) {
              if (id.startsWith('shape:ai-')) deletedRef.current.add(id)
            }
            for (const [id, records] of Object.entries(changes.updated)) {
              if (!id.startsWith('shape:ai-')) continue
              const [oldShape, newShape] = records
              if (oldShape.typeName === 'shape' && newShape.typeName === 'shape' &&
                oldShape.type === 'note' && newShape.type === 'note' &&
                JSON.stringify(oldShape.props.richText) !== JSON.stringify(newShape.props.richText)) {
                protectedRef.current.add(id)
              }
            }
            persist(editor)
          }, { scope: 'document' })
          sync(editor, analysis)
          return () => {
            if (timer.current) clearTimeout(timer.current)
            unlisten()
            editorRef.current = null
          }
        }}
      />
      {!analysis?.cards.length && (
        <div className="pointer-events-none absolute left-1/2 top-20 z-10 -translate-x-1/2 rounded-2xl border stroke surface px-5 py-4 text-center shadow-sm">
          <p className="text-sm font-semibold">ここが会議のホワイトボードです</p>
          <p className="muted mt-1 text-xs">発言を記録するか、AIに整理を指示すると付箋が追加されます。</p>
        </div>
      )}
    </div>
  )
}
