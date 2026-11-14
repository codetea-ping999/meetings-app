import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
// For single-user localhost use only. Add authentication, per-user quota and rate limiting before hosting.
export async function POST() {
  if (!process.env.OPENAI_API_KEY) return NextResponse.json({ error: 'OPENAI_API_KEY が未設定です' }, { status: 503 })
  const session = {
    type: 'transcription',
    audio: { input: {
      format: { type: 'audio/pcm', rate: 24000 },
      transcription: { model: 'gpt-live-transcribe', languages: ['ja'], prompt: '日本語の会議。固有名詞、タスク、決定事項をできる限り正確に認識する。' },
      turn_detection: null,
    } },
  }
  try {
    const upstream = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ session, expires_after: { anchor: 'created_at', seconds: 60 } }),
      cache: 'no-store', signal: AbortSignal.timeout(20_000),
    })
    if (!upstream.ok) {
      console.error('OpenAI token creation failed:', upstream.status, (await upstream.text()).slice(0, 300))
      return NextResponse.json({ error: `音声サービスに接続できませんでした（${upstream.status}）` }, { status: 502 })
    }
    const result = await upstream.json() as { value?: string }
    if (!result.value) throw new Error('No ephemeral key returned')
    // Ephemeral key is intentionally provided to the browser. Main key is never exposed.
    return NextResponse.json({ value: result.value }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('OpenAI ephemeral session error', error)
    return NextResponse.json({ error: '音声サービスへの通信が失敗しました' }, { status: 502 })
  }
}
