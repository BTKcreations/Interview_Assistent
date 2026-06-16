import OpenAI from 'openai'
import {
  OPENAI_API_KEY,
  OPENAI_COMPLETION_MODEL,
  OPENAI_EMBEDDING_MODEL,
  EMBEDDING_PROVIDER,
  HUGGINGFACE_API_KEY,
  HUGGINGFACE_EMBEDDING_MODEL,
  USE_OLLAMA,
  OLLAMA_API_URL,
  OLLAMA_MODEL,
  DEEPGRAM_API_KEY,
  GROQ_API_KEY
} from './config'

const client = new OpenAI({ apiKey: OPENAI_API_KEY })

export function hasOpenAIKey() {
  return OPENAI_API_KEY.length > 0
}

export async function transcribeAudio(buffer: Buffer) {
  // 1. Try Groq FIRST (The "Lightning" Engine - Free & Fastest)
  if (GROQ_API_KEY && GROQ_API_KEY.length > 10) {
    try {
      console.log('⚡ Using Groq Lightning STT...')
      const formData = new FormData()
      formData.append('file', new Blob([new Uint8Array(buffer)]), 'audio.webm')
      formData.append('model', 'whisper-large-v3')
      formData.append('response_format', 'json')
      formData.append('language', 'en') // Force English to stop hallucinations

      const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${GROQ_API_KEY}`
        },
        body: formData
      })
      const data = await response.json()
      let result = data.text || ''

      // Hallucination Filter: Ignore Whisper "garbage" words during silence
      const hallucinations = ['obrigado', 'thank you', 'skål', 'watching', 'subs', 'caption', 'hello everyone', 'bye bye', 'oops']
      const lower = result.toLowerCase().trim()
      if (lower.length < 2 || hallucinations.some(h => lower.includes(h) && lower.length < h.length + 5)) {
        return ''
      }

      if (result) {
        console.log('🎙️ Transcribed:', result)
        return result
      }
    } catch (err) {
      console.warn('Groq STT failed, trying fallbacks...')
    }
  }

  // 2. Backup: Try Deepgram
  if (DEEPGRAM_API_KEY && DEEPGRAM_API_KEY.length > 10) {
    try {
      const response = await fetch('https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${DEEPGRAM_API_KEY}`,
          'Content-Type': 'audio/webm'
        },
        body: buffer as any
      })
      const data = await response.json()
      return data.results?.channels?.[0]?.alternatives?.[0]?.transcript || ''
    } catch { return '' }
  }

  // 3. Backup: Try OpenAI
  if (hasOpenAIKey() && OPENAI_API_KEY !== 'your-openai-api-key') {
    try {
      const file = await OpenAI.toFile(buffer, 'audio.webm', { type: 'audio/webm' })
      const transcription = await client.audio.transcriptions.create({
        file: file,
        model: 'whisper-1',
      })
      return transcription.text
    } catch (err) {
      console.warn('OpenAI STT failed...')
    }
  }

  return ''
}

export function useOllama() {
  return USE_OLLAMA && OLLAMA_API_URL.length > 0 && OLLAMA_MODEL.length > 0
}

export function useOllamaEmbeddings() {
  return EMBEDDING_PROVIDER === 'ollama' && useOllama()
}

export function useHuggingFaceEmbeddings() {
  return EMBEDDING_PROVIDER === 'huggingface' && HUGGINGFACE_API_KEY.length > 0
}

export function useLocalEmbeddings() {
  return EMBEDDING_PROVIDER === 'local'
}

export function hasEmbeddingProvider() {
  if (useLocalEmbeddings()) return true
  return useHuggingFaceEmbeddings() || useOllamaEmbeddings() || hasOpenAIKey()
}

export function createLocalEmbedding(text: string) {
  const normalized = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const tokens = normalized.split(' ').filter(Boolean)
  const counts = new Map<string, number>()

  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1)
  }

  const vector: number[] = []
  const sortedTokens = Array.from(counts.keys()).sort()

  for (const token of sortedTokens) {
    vector.push(counts.get(token) ?? 0)
  }

  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0))
  if (magnitude === 0) return vector

  return vector.map((value) => value / magnitude)
}

async function createOllamaEmbedding(text: string) {
  const response = await fetch(`${OLLAMA_API_URL}/api/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: OLLAMA_MODEL, input: text })
  })

  if (!response.ok) {
    throw new Error(`Ollama embedding request failed: ${response.statusText}`)
  }

  const data = await response.json()
  const embedding = Array.isArray(data.embeddings?.[0])
    ? data.embeddings[0]
    : Array.isArray(data.embedding)
    ? data.embedding
    : undefined

  if (!Array.isArray(embedding)) {
    throw new Error('Ollama embedding response did not include a vector.')
  }

  return embedding as number[]
}

async function createHuggingFaceEmbedding(text: string) {
  const url = `https://router.huggingface.co/hf-inference/models/${HUGGINGFACE_EMBEDDING_MODEL}/v1/embeddings`

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${HUGGINGFACE_API_KEY}`
    },
    body: JSON.stringify({ inputs: [text] })
  })

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '')
    throw new Error(`HuggingFace embedding failed (${response.status}): ${errorBody}`)
  }

  const data = await response.json()

  // HF Inference API returns embeddings in OpenAI-compatible format:
  // { data: [{ embedding: [...], index: 0 }] }
  // or as a flat/nested array for older endpoints
  const embedding = Array.isArray(data?.data?.[0]?.embedding)
    ? data.data[0].embedding
    : Array.isArray(data)
    ? (Array.isArray(data[0]) ? data[0] : data)
    : Array.isArray(data?.embeddings?.[0])
    ? data.embeddings[0]
    : undefined

  if (!Array.isArray(embedding) || typeof embedding[0] !== 'number') {
    throw new Error('HuggingFace embedding response did not include a valid vector.')
  }

  return embedding as number[]
}

// Track if the configured provider has already failed, so we skip it on future calls
let providerFailed = false

export async function createEmbedding(text: string) {
  // If the configured provider already failed once, go straight to local
  if (providerFailed || useLocalEmbeddings()) {
    return createLocalEmbedding(text)
  }

  try {
    if (useHuggingFaceEmbeddings()) {
      return await createHuggingFaceEmbedding(text)
    }

    if (useOllamaEmbeddings()) {
      return await createOllamaEmbedding(text)
    }

    if (hasOpenAIKey()) {
      const response = await client.embeddings.create({
        model: OPENAI_EMBEDDING_MODEL,
        input: text
      })

      const embedding = response.data?.[0]?.embedding
      if (!Array.isArray(embedding)) {
        throw new Error('OpenAI embedding response did not include a vector.')
      }

      return embedding as number[]
    }

    if (USE_OLLAMA && useOllama()) {
      return await createOllamaEmbedding(text)
    }

    if (HUGGINGFACE_API_KEY.length > 0) {
      return await createHuggingFaceEmbedding(text)
    }

    throw new Error('No embedding provider configured.')
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.warn(`Embedding provider failed, switching to local embeddings for this session: ${msg}`)
    providerFailed = true
    return createLocalEmbedding(text)
  }
}

async function streamOllamaCompletion(
  prompt: string,
  onChunk: (chunk: string) => void,
  onComplete: () => void,
  onError: (error: Error) => void,
  base64Image?: string
) {
  // If we have an image, we need to strip the data:image/... prefix for Ollama
  const imageContent = base64Image?.split(',')[1] || base64Image

  const response = await fetch(`${OLLAMA_API_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      messages: [
        { 
          role: 'user', 
          content: prompt,
          ...(imageContent ? { images: [imageContent] } : {})
        }
      ],
      stream: true
    })
  })

  if (!response.ok) {
    throw new Error(`Ollama completion request failed: ${response.statusText}`)
  }

  const reader = response.body?.getReader()
  if (!reader) {
    throw new Error('Ollama response body is unavailable.')
  }

  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.trim()) continue

        try {
          const event = JSON.parse(line)
          const text = event?.message?.content ?? event?.response ?? ''

          if (typeof text === 'string') {
            onChunk(text)
          }
        } catch {
          /* ignore parse errors for partial lines */
        }
      }
    }

    if (buffer.trim()) {
      try {
        const event = JSON.parse(buffer)
        const text = event?.message?.content ?? event?.response ?? ''
        if (typeof text === 'string') {
          onChunk(text)
        }
      } catch {
        // final partial line ignored if malformed
      }
    }

    onComplete()
  } catch (error) {
    onError(error as Error)
  }
}

export async function streamChatCompletion(
  prompt: string,
  onChunk: (chunk: string) => void,
  onComplete: () => void,
  onError: (error: Error) => void
) {
  if (useOllama()) {
    return await streamOllamaCompletion(prompt, onChunk, onComplete, onError)
  }

  if (!hasOpenAIKey()) {
    throw new Error('No OpenAI key available for chat completion.')
  }

  const response = await client.chat.completions.create({
    model: OPENAI_COMPLETION_MODEL,
    messages: [
      {
        role: 'system',
        content: 'You are a real-time interview assistant. Answer questions concisely using candidate resume context.'
      },
      {
        role: 'user',
        content: prompt
      }
    ],
    stream: true
  })

  try {
    for await (const event of response as any) {
      const delta = event?.delta ?? event?.choices?.[0]?.delta
      const text = delta?.content ?? event?.choices?.[0]?.delta?.content

      if (typeof text === 'string') {
        onChunk(text)
      }
    }

    onComplete()
  } catch (error) {
    onError(error as Error)
  }
}

export async function streamVisionCompletion(
  prompt: string,
  base64Image: string,
  onChunk: (chunk: string) => void,
  onComplete: () => void,
  onError: (error: Error) => void
) {
  if (useOllama()) {
    try {
      return await streamOllamaCompletion(prompt, onChunk, onComplete, onError, base64Image)
    } catch (error) {
      console.warn('Ollama vision failed, falling back to OpenAI if available...')
    }
  }

  if (!hasOpenAIKey()) {
    onError(new Error('OpenAI API key or Ollama vision model required.'))
    return
  }

  try {
    const stream = await client.chat.completions.create({
      model: OPENAI_COMPLETION_MODEL.includes('gpt-4o') ? OPENAI_COMPLETION_MODEL : 'gpt-4o-mini',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            {
              type: 'image_url',
              image_url: {
                url: base64Image,
              }
            }
          ]
        }
      ],
      stream: true
    })

    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content || ''
      if (text) onChunk(text)
    }

    onComplete()
  } catch (error) {
    onError(error instanceof Error ? error : new Error(String(error)))
  }
}
