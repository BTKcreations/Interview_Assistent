import WebSocket from 'ws'
import { DEEPGRAM_API_KEY, DEEPGRAM_LANGUAGE, DEEPGRAM_MODEL } from './config'

export type DeepgramTranscriptCallback = (transcript: string, isFinal: boolean) => void

export function createDeepgramStream(
  onTranscript: DeepgramTranscriptCallback,
  onError: (error: Error) => void,
  onClose: () => void
) {
  if (!DEEPGRAM_API_KEY) {
    throw new Error('Deepgram API key is not configured.')
  }

  const url = `wss://api.deepgram.com/v1/listen?language=${encodeURIComponent(
    DEEPGRAM_LANGUAGE
  )}&model=${encodeURIComponent(DEEPGRAM_MODEL)}&punctuate=true&interim_results=true&encoding=opus&container=webm&keepalive=true`

  console.log('[STT] Connecting to Deepgram:', url, '| Key prefix:', DEEPGRAM_API_KEY.slice(0, 8) + '...')

  const dgSocket = new WebSocket(url, {
    headers: {
      Authorization: `Token ${DEEPGRAM_API_KEY}`
    }
  })

  dgSocket.on('open', () => {
    console.log('[STT] Deepgram WebSocket connected successfully')
  })

  dgSocket.on('message', (raw) => {
    try {
      const data = JSON.parse(raw.toString())
      const transcript = data.channel?.alternatives?.[0]?.transcript
      const isFinal = Boolean(data.is_final)

      if (typeof transcript === 'string' && transcript.trim().length > 0) {
        onTranscript(transcript, isFinal)
      }
    } catch (error) {
      // ignore transient parse issues
    }
  })

  dgSocket.on('error', (error) => {
    console.error('[STT] Deepgram WebSocket error:', error.message ?? error)
    onError(error instanceof Error ? error : new Error(String(error)))
  })

  dgSocket.on('close', (code, reason) => {
    const reasonStr = reason?.toString() || 'No reason provided'
    console.log(`[STT] Deepgram WebSocket closed. Code: ${code}, Reason: ${reasonStr}`)
    onClose()
  })

  return {
    sendAudio: (data: Buffer) => {
      if (dgSocket.readyState === WebSocket.OPEN) {
        dgSocket.send(data)
      }
    },
    close: () => {
      if (dgSocket.readyState === WebSocket.OPEN) {
        dgSocket.close()
      }
    }
  }
}
