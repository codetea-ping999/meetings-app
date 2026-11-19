'use client'
import { useCallback, useEffect, useRef, useState } from 'react'

type LiveStatus = 'idle' | 'connecting' | 'live' | 'stopping'
type LiveEvent = { type: string; item_id?: string; delta?: string; transcript?: string; error?: { message?: string } }

export function useLiveTranscription(onFinal: (text: string) => void) {
  const onFinalRef = useRef(onFinal)
  useEffect(() => { onFinalRef.current = onFinal }, [onFinal])
  const [status, setStatus] = useState<LiveStatus>('idle')
  const [interim, setInterim] = useState('')
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const dataRef = useRef<RTCDataChannel | null>(null)
  const contextRef = useRef<AudioContext | null>(null)
  const streamsRef = useRef<MediaStream[]>([])
  const tickerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const busyRef = useRef(false)

  const cleanup = useCallback(() => {
    if (tickerRef.current) clearInterval(tickerRef.current)
    tickerRef.current = null
    dataRef.current?.close()
    dataRef.current = null
    pcRef.current?.close()
    pcRef.current = null
    for (const stream of streamsRef.current) stream.getTracks().forEach(t => t.stop())
    streamsRef.current = []
    void contextRef.current?.close().catch(() => undefined)
    contextRef.current = null
    busyRef.current = false
    setStatus('idle')
    setInterim('')
  }, [])
  useEffect(() => () => cleanup(), [cleanup])

  const start = useCallback(async (captureSystem: boolean) => {
    if (busyRef.current) return
    busyRef.current = true
    setStatus('connecting')
    setError('')
    setInfo('')
    const partial = new Map<string, string>()
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('このブラウザはマイク入力に対応していません')
      // getDisplayMedia must run during the click gesture in supporting browsers.
      let display: MediaStream | null = null
      if (captureSystem) {
        if (!navigator.mediaDevices.getDisplayMedia) throw new Error('このブラウザではタブ・画面音声を取得できません')
        display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
        streamsRef.current.push(display)
        if (display.getAudioTracks().length === 0) setInfo('共有先の音声は取得できませんでした。マイク音声だけを利用します。')
      }
      const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      streamsRef.current.push(mic)

      // Mix microphone and optional system audio to exactly one outgoing WebRTC track.
      const audio = new AudioContext()
      contextRef.current = audio
      await audio.resume()
      const destination = audio.createMediaStreamDestination()
      const micSource = audio.createMediaStreamSource(mic)
      micSource.connect(destination)
      if (display?.getAudioTracks().length) audio.createMediaStreamSource(display).connect(destination)
      const analyzer = audio.createAnalyser()
      analyzer.fftSize = 2048
      audio.createMediaStreamSource(destination.stream).connect(analyzer)
      const waveform = new Float32Array(analyzer.fftSize)
      const peer = new RTCPeerConnection()
      pcRef.current = peer
      peer.addTrack(destination.stream.getAudioTracks()[0], destination.stream)
      const channel = peer.createDataChannel('oai-events')
      dataRef.current = channel
      channel.onmessage = (message) => {
        let event: LiveEvent
        try { event = JSON.parse(message.data) as LiveEvent } catch { return }
        if (event.type === 'conversation.item.input_audio_transcription.delta' && event.item_id) {
          const next = (partial.get(event.item_id) || '') + (event.delta || '')
          partial.set(event.item_id, next)
          setInterim(next)
        }
        if (event.type === 'conversation.item.input_audio_transcription.completed' && event.item_id) {
          partial.delete(event.item_id)
          setInterim('')
          if (event.transcript?.trim()) onFinalRef.current(event.transcript.trim())
        }
        if (event.type === 'conversation.item.input_audio_transcription.failed' || event.type === 'error') {
          setError(event.error?.message || '文字起こしの処理に失敗しました')
        }
      }
      const offer = await peer.createOffer()
      await peer.setLocalDescription(offer)
      const tokenResponse = await fetch('/api/realtime', { method: 'POST' })
      const token = await tokenResponse.json() as { value?: string; error?: string }
      if (!tokenResponse.ok || !token.value) throw new Error(token.error || '一時接続キーを取得できませんでした')
      const response = await fetch('https://api.openai.com/v1/realtime/calls', {
        method: 'POST', headers: { Authorization: `Bearer ${token.value}`, 'Content-Type': 'application/sdp' },
        body: offer.sdp,
      })
      if (!response.ok) throw new Error(`音声接続に失敗しました（${response.status}）`)
      await peer.setRemoteDescription({ type: 'answer', sdp: await response.text() })
      if (channel.readyState !== 'open') {
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('音声通信の接続がタイムアウトしました')), 12000)
          channel.addEventListener('open', () => { clearTimeout(timeout); resolve() }, { once: true })
        })
      }
      setStatus('live')

      // gpt-live-transcribe needs explicit commits. Local energy VAD commits on silence;
      // a maximum interval prevents long uninterrupted speech from remaining unfinalized.
      let lastLoud = Date.now()
      let lastCommit = Date.now()
      let detectedSpeech = false
      tickerRef.current = setInterval(() => {
        if (channel.readyState !== 'open') return
        analyzer.getFloatTimeDomainData(waveform)
        let sum = 0
        for (const sample of waveform) sum += sample * sample
        const rms = Math.sqrt(sum / waveform.length)
        const now = Date.now()
        if (rms > 0.018) { detectedSpeech = true; lastLoud = now }
        const silenceEnd = detectedSpeech && now - lastLoud > 1000 && now - lastCommit > 1000
        const maxChunk = detectedSpeech && now - lastCommit > 12000
        if (silenceEnd || maxChunk) {
          channel.send(JSON.stringify({ type: 'input_audio_buffer.commit' }))
          detectedSpeech = false
          lastCommit = now
        }
      }, 180)
    } catch (err) {
      setError(err instanceof Error ? err.message : '音声入力を開始できませんでした')
      cleanup()
    }
  }, [cleanup])

  const stop = useCallback(async () => {
    if (!busyRef.current) return
    setStatus('stopping')
    if (tickerRef.current) clearInterval(tickerRef.current)
    tickerRef.current = null
    if (dataRef.current?.readyState === 'open') {
      dataRef.current.send(JSON.stringify({ type: 'input_audio_buffer.commit' }))
      await new Promise(resolve => setTimeout(resolve, 1300))
    }
    cleanup()
  }, [cleanup])
  return { status, interim, error, info, start, stop }
}
