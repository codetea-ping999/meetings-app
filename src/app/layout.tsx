import type { Metadata } from 'next'
import './globals.css'
import 'tldraw/tldraw.css'

export const metadata: Metadata = {
  title: 'Meetings Studio | AI 会議ワークスペース',
  description: '会議の内容をリアルタイムに整理する独立型 AI ホワイトボード',
}
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ja"><body>{children}</body></html>
}
