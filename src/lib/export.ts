import type { Meeting } from '@/types/meeting'

export function toMarkdown(m: Meeting): string {
  const a = m.analysis
  const lines = [
    `# ${m.title.replace(/\r?\n/g, ' ')}`,
    '', `- 開始: ${m.startedAt}`, `- 終了: ${m.endedAt ?? '進行中'}`,
    '', '## 要約', '', a?.summary || '（未生成）',
    '', '## 議事録', '', a?.minutes || '（未生成）',
    '', '## アクションアイテム', '',
    ...(a?.actions.length ? a.actions.map((item) => `- [ ] ${item.task}（担当: ${item.owner || '未定'} / 期限: ${item.due || '未定'}）`) : ['（未生成）']),
    '', '## ホワイトボード上の付箋', '',
    ...(a?.cards.length ? a.cards.map((item) => `- **${item.category}**: ${item.text}`) : ['（未生成）']),
    '', '## 会話ログ', '',
    ...m.transcript.map((line) => `- ${new Date(line.at).toLocaleTimeString('ja-JP')}: ${line.text.replace(/\r?\n/g, ' ')}`),
  ]
  return lines.join('\n') + '\n'
}

export function downloadFile(name: string, text: string, mime: string) {
  const objectUrl = URL.createObjectURL(new Blob([text], { type: mime }))
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = name
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 2000)
}
