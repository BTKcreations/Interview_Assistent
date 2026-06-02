import express, { Request, Response } from 'express'
import http from 'http'
import cors from 'cors'
import fs from 'fs/promises'
import multer from 'multer'
import { WebSocketServer, WebSocket } from 'ws'
import { BACKEND_PORT, DEEPGRAM_API_KEY } from './config'
import { ingestResumeText, retrieveResumeContext, buildAssistantPrompt, streamAssistantResponse, streamVisionAssistantResponse } from './assistant'
import { extractTextFromPdf, extractTextFromPlainFile } from './fileUpload'
import { listDocuments, deleteDocument, getStorageStats } from './vectorStore'
import { transcribeAudio } from './openaiClient'
import { createDeepgramStream } from './deepgramStream'

const PORT = BACKEND_PORT
const upload = multer({ dest: 'uploads/' })
const app = express()

app.use(cors())
app.use(express.json())

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'backend' })
})

app.delete('/documents/:id', (req: Request, res: Response) => {
  const success = deleteDocument(req.params.id)
  res.json({ success })
})

app.get('/storage-stats', (_req: Request, res: Response) => {
  res.json(getStorageStats())
})

app.post('/ingest-resume', async (req: Request, res: Response) => {
  const { text, name } = req.body
  if (typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ status: 'error', message: 'Resume text is required.' })
  }

  try {
    const documentId = await ingestResumeText(text, name || 'manual_entry.txt')
    res.json({ status: 'accepted', documentId, message: 'Document ingested successfully.' })
  } catch (error) {
    console.error('Ingestion error:', error)
    const message = error instanceof Error ? error.message : 'Ingestion failed.'
    res.status(500).json({ status: 'error', message })
  }
})

app.post('/upload-resume', upload.single('resume'), async (req: Request, res: Response) => {
  const file = (req as any).file as Express.Multer.File | undefined

  if (!file) {
    return res.status(400).json({ status: 'error', message: 'No file was uploaded.' })
  }

  try {
    const fileType = file.mimetype
    let text = ''

    if (fileType === 'application/pdf') {
      text = await extractTextFromPdf(file.path)
    } else {
      text = await extractTextFromPlainFile(file.path)
    }

    if (!text.trim()) {
      return res.status(400).json({ status: 'error', message: 'Uploaded file did not contain readable text.' })
    }

    const documentId = await ingestResumeText(text, file.originalname, file.size)

    // Clean up
    try { await fs.unlink(file.path) } catch {}

    res.json({ status: 'accepted', documentId, message: 'Document ingested successfully.' })
  } catch (error) {
    if (file?.path) try { await fs.unlink(file.path) } catch {}
    console.error('Upload error:', error)
    const message = error instanceof Error ? error.message : 'Failed to parse file.'
    res.status(500).json({ status: 'error', message })
  }
})

const server = http.createServer(app)
const wss = new WebSocketServer({ server })

export { app, server }

function sendJson(socket: any, payload: Record<string, unknown>) {
  socket.send(JSON.stringify(payload))
}

async function ensureUploadDirectory() {
  try {
    await fs.mkdir('uploads', { recursive: true })
  } catch (error) {
    console.warn('Could not ensure uploads directory exists:', error)
  }
}

wss.on('connection', (socket) => {
  console.log('Frontend connected.')
  sendJson(socket, { type: 'welcome', text: 'Backend websocket connected.' })

  const sttState: {
    deepgram?: ReturnType<typeof createDeepgramStream>
    ready: boolean
  } = {
    ready: false
  }

  const closeSttSession = () => {
    if (sttState.deepgram) {
      sttState.deepgram.close()
      sttState.deepgram = undefined
    }
    sttState.ready = false
  }

  socket.on('close', () => {
    closeSttSession()
  })

  // SMART MIND: Active stream tracking and memory per socket
  const activeStreams = new Map<WebSocket, AbortController>()
  let lastVisionResult = ''

  socket.on('message', async (data) => {
    let event
    try {
      event = JSON.parse(data.toString())
      if (event.type !== 'stt-chunk') {
         console.log(`[Backend] Received event: ${event.type}`)
      }
    } catch (error) {
      return sendJson(socket, { type: 'error', message: 'Invalid message payload.' })
    }

    if (event.type === 'client-ready') {
      return sendJson(socket, { type: 'status', text: 'Backend is ready for interview streaming.' })
    }

    if (event.type === 'ask-question') {
      const question = typeof event.question === 'string' ? event.question : ''
      
      // INTERRUPT: Kill existing response if any
      const wsSocket = socket as any as WebSocket
      if (activeStreams.has(wsSocket)) {
        activeStreams.get(wsSocket)?.abort()
        activeStreams.delete(wsSocket)
        console.log('🛑 INTERRUPT: Aborted previous generation for new question.')
      }

      const controller = new AbortController()
      activeStreams.set(wsSocket, controller)

      const resumeContext = await retrieveResumeContext(question)
      const prompt = buildAssistantPrompt(question, resumeContext, lastVisionResult)

      sendJson(socket, { type: 'assistant-start', text: 'Thinking...' })

      await streamAssistantResponse(
        prompt,
        (chunk) => {
          if (controller.signal.aborted) return
          sendJson(socket, { type: 'assistant-chunk', text: chunk })
        },
        () => {
          if (controller.signal.aborted) return
          activeStreams.delete(wsSocket)
          sendJson(socket, { type: 'assistant-end', text: 'Response complete.' })
        }
      )
      return
    }

    if (event.type === 'stt-chunk') {
      const audioBase64 = typeof event.audio === 'string' ? event.audio : ''
      if (!audioBase64) return
      const audioBuffer = Buffer.from(audioBase64, 'base64')
      
      transcribeAudio(audioBuffer).then(text => {
        if (text && text.trim().length > 10) {
          sendJson(socket, { type: 'stt-result', text })

          // AUTO-DETECT: Does this sound like a question for the candidate?
          const questionPatterns = [
            'tell me about', 'what is your', 'how would you', 'can you explain',
            'describe a', 'experience with', 'why should we', 'your background',
            'what are your', 'how do you', 'in your opinion', 'where do you see',
            'give me an example'
          ]

          const lowerText = text.toLowerCase()
          const isInterviewQuestion = questionPatterns.some(p => lowerText.includes(p)) || text.includes('?')

          if (isInterviewQuestion) {
            console.log('🚀 [SmartMic] AUTO-TRIGGER: Detected interview question!')
            // Call the ask-question logic manually
            socket.emit('message', JSON.stringify({ type: 'ask-question', question: text }))
          }
        }
      }).catch(err => console.error('STT Error:', err))
      return
    }

    if (event.type === 'relay-transcript') {
      const { text, isFinal } = event
      wss.clients.forEach((client) => {
        if (client !== socket && client.readyState === socket.OPEN) {
          client.send(JSON.stringify({ type: 'remote-transcript', text, isFinal }))
        }
      })
      return
    }

    if (event.type === 'ask-vision') {
      const { image, prompt } = event
      if (!image) return sendJson(socket, { type: 'error', message: 'No image provided.' })

      sendJson(socket, { type: 'assistant-start', text: 'Analyzing screenshot...' })
      let fullVisionText = ''

      await streamVisionAssistantResponse(
        prompt || 'Identify the coding problem in this image and provide an optimized solution. Use Markdown code blocks.',
        image,
        (chunk) => {
          fullVisionText += chunk
          sendJson(socket, { type: 'assistant-chunk', text: chunk })
        },
        () => {
          lastVisionResult = fullVisionText // SAVE TO MEMORY
          sendJson(socket, { type: 'assistant-end', text: 'Analysis complete.' })
        }
      )
      return
    }

    if (event.type === 'stt-start') {
      if (!DEEPGRAM_API_KEY || DEEPGRAM_API_KEY === 'your-deepgram-api-key') {
        return sendJson(socket, {
          type: 'stt-error',
          text: 'Deepgram API key is not configured. Add DEEPGRAM_API_KEY to your .env file.'
        })
      }

      try {
        closeSttSession()
        sttState.deepgram = createDeepgramStream(
          (text: string, isFinal: boolean) => {
            if (text.trim()) {
              console.log(`[STT] Transcript: "${text}" (final: ${isFinal})`)
              sendJson(socket, { type: 'transcript-chunk', text, isFinal })
            }
          },
          (error: Error) => {
            console.error('[STT] Deepgram error:', error.message)
            sendJson(socket, { type: 'stt-error', text: error.message })
            closeSttSession()
          },
          () => {
            console.log('[STT] Deepgram session ended normally.')
            sendJson(socket, { type: 'stt-ended', text: 'Deepgram session closed.' })
            closeSttSession()
          }
        )

        sttState.ready = true
        return sendJson(socket, { type: 'stt-ready', text: 'Deepgram live stream started.' })
      } catch (error) {
        return sendJson(socket, { type: 'stt-error', text: `STT failed: ${(error as Error).message}` })
      }
    }

    if (event.type === 'stt-start') {
      // (Deepgram logic preserved here)
      // ... 
    }

    if (event.type === 'stt-stop') {
      closeSttSession()
      return sendJson(socket, { type: 'stt-stopped', text: 'Live transcription stopped.' })
    }

    if (event.type === 'debug') {
      console.log(`[DEBUG] ${event.message}`)
      return
    }

    if (event.type === 'transcript') {
      const transcript = typeof event.text === 'string' ? event.text : ''
      console.log('Transcript received:', transcript)
      return sendJson(socket, { type: 'transcript-ack', text: `Transcript accepted: ${transcript}` })
    }

    sendJson(socket, { type: 'error', message: 'Unknown event type.' })
  })
})

export async function startBackend(port = PORT) {
  await ensureUploadDirectory()

  return new Promise<void>((resolve, reject) => {
    if (server.listening) {
      resolve()
      return
    }

    server.listen(port, () => {
      console.log(`Backend listening on http://localhost:${port}`)
      resolve()
    })
    server.on('error', reject)
  })
}

if (process.env.NODE_ENV !== 'test') {
  startBackend().catch((error) => {
    console.error('Failed to start backend:', error)
    process.exit(1)
  })
}
