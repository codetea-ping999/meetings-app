import test from 'node:test'
import assert from 'node:assert/strict'
import { toMarkdown } from '../src/lib/export.ts'

test('Markdown contains summary, action items and transcript', () => {
  const meeting = {
    id: 'm1', title: '設計レビュー', startedAt: '2026-11-14T11:00:00.000Z', endedAt: null,
    transcript: [{ id: '1', at: '2026-11-14T11:00:00.000Z', text: 'APIを先に実装します', source: 'manual' }],
    analysis: { summary: 'API開発を優先。', minutes: '- APIの調査が必要。',
      actions: [{ id: 'a1', task: 'API調査', owner: '田中', due: '11月20日' }],
      cards: [{ id: 'c1', category: 'アクション', text: '調査する' }],
      diagram: { kind: 'stickies', edges: [] }, updatedAt: '' },
  }
  const markdown = toMarkdown(meeting)
  assert.match(markdown, /^# 設計レビュー/m)
  assert.match(markdown, /API開発を優先/)
  assert.match(markdown, /- \[ \] API調査（担当: 田中 \/ 期限: 11月20日）/)
  assert.match(markdown, /会話ログ/)
  assert.match(markdown, /APIを先に実装します/)
})

test('Markdown works without AI analysis', () => {
  const markdown = toMarkdown({ title: '空の会議', startedAt: '2026-11-14', endedAt: null, transcript: [], analysis: null })
  assert.match(markdown, /（未生成）/)
})
