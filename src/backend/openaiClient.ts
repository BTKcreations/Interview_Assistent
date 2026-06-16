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
  GROQ_API_KEY,
  GROQ_CHAT_MODEL,
  GOOGLE_AI_API_KEY,
  GOOGLE_AI_MODEL,
  OPENROUTER_API_KEY,
  OPENROUTER_CHAT_MODEL
} from './config'

// OpenAI client (last resort - paid)
const openaiClient = new OpenAI({ apiKey: OPENAI_API_KEY })

// Groq client (OpenAI-compatible, fastest free)
const groqClient = new OpenAI({
  apiKey: GROQ_API_KEY,
  baseURL: 'https://api.groq.com/openai/v1'
})

// OpenRouter client (OpenAI-compatible, most free models)
const openrouterClient = new OpenAI({
  apiKey: OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1'
})

// ============================================
// PROVIDER DETECTION
// ============================================

export function hasGroqKey() {
  return GROQ_API_KEY.length > 10
}

export function hasGoogleAIKey() {
  return GOOGLE_AI_API_KEY.length > 10
}

export function hasOpenRouterKey() {
  return OPENROUTER_API_KEY.length > 10
}

export function useOllama() {
  return USE_OLLAMA && OLLAMA_API_URL.length > 0 && OLLAMA_MODEL.length > 0
}

export function hasOpenAIKey() {
  return OPENAI_API_KEY.length > 10 && OPENAI_API_KEY !== 'your-openai-api-key'
}

// ============================================
// STT (Speech-to-Text) - Priority: Groq > Deepgram > OpenAI
// ============================================

export async function transcribeAudio(buffer: Buffer) {
  // 1. Groq Whisper (FASTEST - Free)
  if (hasGroqKey()) {
    try {
      console.log('[STT] Trying Groq Whisper...')
      const formData = new FormData()
      formData.append('file', new Blob([new Uint8Array(buffer)]), 'audio.webm')
      formData.append('model', 'whisper-large-v3-turbo')
      formData.append('response_format', 'json')
      formData.append('language', 'en')

      const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${GROQ_API_KEY}` },
        body: formData
      })
      const data = await response.json()
      let result = data.text || ''

      // Hallucination Filter
      const hallucinations = ['obrigado', 'thank you', 'skål', 'watching', 'subs', 'caption', 'hello everyone', 'bye bye', 'oops']
      const lower = result.toLowerCase().trim()
      if (lower.length < 2 || hallucinations.some(h => lower.includes(h) && lower.length < h.length + 5)) {
        return ''
      }

      if (result) {
        console.log('[STT] Groq transcribed:', result)
        return result
      }
    } catch (err) {
      console.warn('[STT] Groq failed, trying fallbacks...')
    }
  }

  // 2. Deepgram (Free $200 credits)
  if (DEEPGRAM_API_KEY && DEEPGRAM_API_KEY.length > 10) {
    try {
      console.log('[STT] Trying Deepgram...')
      const response = await fetch('https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${DEEPGRAM_API_KEY}`,
          'Content-Type': 'audio/webm'
        },
        body: buffer as any
      })
      const data = await response.json()
      const result = data.results?.channels?.[0]?.alternatives?.[0]?.transcript || ''
      if (result) {
        console.log('[STT] Deepgram transcribed:', result)
        return result
      }
    } catch { /* continue */ }
  }

  // 3. OpenAI Whisper (PAID - last resort)
  if (hasOpenAIKey()) {
    try {
      console.log('[STT] Trying OpenAI Whisper...')
      const file = await OpenAI.toFile(buffer, 'audio.webm', { type: 'audio/webm' })
      const transcription = await openaiClient.audio.transcriptions.create({
        file: file,
        model: 'whisper-1',
      })
      if (transcription.text) {
        console.log('[STT] OpenAI transcribed:', transcription.text)
        return transcription.text
      }
    } catch (err) {
      console.warn('[STT] OpenAI Whisper failed...')
    }
  }

  return ''
}

// ============================================
// EMBEDDINGS - Priority: Local > HuggingFace > Ollama > OpenAI
// ============================================

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

// Track if the configured provider has already failed
let providerFailed = false

export async function createEmbedding(text: string) {
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
      const response = await openaiClient.embeddings.create({
        model: OPENAI_EMBEDDING_MODEL,
        input: text
      })

      const embedding = response.data?.[0]?.embedding
      if (!Array.isArray(embedding)) {
        throw new Error('OpenAI embedding response did not include a vector.')
      }

      return embedding as number[]
    }

    throw new Error('No embedding provider configured.')
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.warn(`Embedding provider failed, switching to local embeddings: ${msg}`)
    providerFailed = true
    return createLocalEmbedding(text)
  }
}

// ============================================
// CHAT COMPLETIONS - Priority: Groq > Gemini > Ollama > OpenRouter > OpenAI
// ============================================

async function streamGroqCompletion(
  prompt: string,
  onChunk: (chunk: string) => void,
  onComplete: () => void,
  onError: (error: Error) => void
) {
  try {
    console.log('[Chat] Using Groq (fastest free)...')
    const stream = await groqClient.chat.completions.create({
      model: GROQ_CHAT_MODEL,
      messages: [
        {
          role: 'system',
          content: 'You are a real-time interview assistant. Answer questions concisely using candidate resume context.'
        },
        { role: 'user', content: prompt }
      ],
      stream: true,
      max_tokens: 1024
    })

    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content
      if (typeof text === 'string') onChunk(text)
    }

    onComplete()
  } catch (error) {
    onError(error as Error)
  }
}

async function streamGoogleGeminiCompletion(
  prompt: string,
  onChunk: (chunk: string) => void,
  onComplete: () => void,
  onError: (error: Error) => void
) {
  try {
    console.log('[Chat] Using Google Gemini (smartest free)...')
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GOOGLE_AI_MODEL}:streamGenerateContent?key=${GOOGLE_AI_API_KEY}`

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: `You are a real-time interview assistant. Answer questions concisely using candidate resume context.\n\n${prompt}`
          }]
        }],
        generationConfig: {
          maxOutputTokens: 1024,
          temperature: 0.7
        }
      })
    })

    if (!response.ok) {
      throw new Error(`Gemini API error: ${response.status} ${response.statusText}`)
    }

    const reader = response.body?.getReader()
    if (!reader) throw new Error('No response body')

    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.trim() || line.trim() === ',') continue
        try {
          // Gemini streams JSON objects, try to parse the candidates
          const clean = line.replace(/^,?\s*/, '')
          if (clean.startsWith('{')) {
            const obj = JSON.parse(clean)
            const text = obj?.candidates?.[0]?.content?.parts?.[0]?.text
            if (typeof text === 'string') onChunk(text)
          }
        } catch { /* partial chunk */ }
      }
    }

    onComplete()
  } catch (error) {
    onError(error as Error)
  }
}

async function streamOllamaCompletion(
  prompt: string,
  onChunk: (chunk: string) => void,
  onComplete: () => void,
  onError: (error: Error) => void,
  base64Image?: string
) {
  const imageContent = base64Image?.split(',')[1] || base64Image

  try {
    console.log('[Chat] Using Ollama (local unlimited)...')
    const response = await fetch(`${OLLAMA_API_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages: [
          {
            role: 'system',
            content: 'You are a real-time interview assistant. Answer questions concisely using candidate resume context.'
          },
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
      throw new Error(`Ollama request failed: ${response.statusText}`)
    }

    const reader = response.body?.getReader()
    if (!reader) throw new Error('No response body')

    const decoder = new TextDecoder()
    let buffer = ''

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
          if (typeof text === 'string') onChunk(text)
        } catch { /* partial line */ }
      }
    }

    if (buffer.trim()) {
      try {
        const event = JSON.parse(buffer)
        const text = event?.message?.content ?? event?.response ?? ''
        if (typeof text === 'string') onChunk(text)
      } catch { /* ignore */ }
    }

    onComplete()
  } catch (error) {
    onError(error as Error)
  }
}

async function streamOpenRouterCompletion(
  prompt: string,
  onChunk: (chunk: string) => void,
  onComplete: () => void,
  onError: (error: Error) => void
) {
  try {
    console.log('[Chat] Using OpenRouter (most models free)...')
    const stream = await openrouterClient.chat.completions.create({
      model: OPENROUTER_CHAT_MODEL,
      messages: [
        {
          role: 'system',
          content: 'You are a real-time interview assistant. Answer questions concisely using candidate resume context.'
        },
        { role: 'user', content: prompt }
      ],
      stream: true,
      max_tokens: 1024
    })

    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content
      if (typeof text === 'string') onChunk(text)
    }

    onComplete()
  } catch (error) {
    onError(error as Error)
  }
}

// Main chat completion with fallback chain
export async function streamChatCompletion(
  prompt: string,
  onChunk: (chunk: string) => void,
  onComplete: () => void,
  onError: (error: Error) => void
) {
  // 1. Groq (FASTEST)
  if (hasGroqKey()) {
    let failed = false
    await streamGroqCompletion(prompt, onChunk, () => onComplete(), (err) => {
      console.warn('[Chat] Groq failed:', err.message)
      failed = true
    })
    if (!failed) return
  }

  // 2. Google Gemini (SMARTEST)
  if (hasGoogleAIKey()) {
    let failed = false
    await streamGoogleGeminiCompletion(prompt, onChunk, () => onComplete(), (err) => {
      console.warn('[Chat] Gemini failed:', err.message)
      failed = true
    })
    if (!failed) return
  }

  // 3. Ollama (LOCAL - Unlimited)
  if (useOllama()) {
    let failed = false
    await streamOllamaCompletion(prompt, onChunk, () => onComplete(), (err) => {
      console.warn('[Chat] Ollama failed:', err.message)
      failed = true
    })
    if (!failed) return
  }

  // 4. OpenRouter (MOST MODELS)
  if (hasOpenRouterKey()) {
    let failed = false
    await streamOpenRouterCompletion(prompt, onChunk, () => onComplete(), (err) => {
      console.warn('[Chat] OpenRouter failed:', err.message)
      failed = true
    })
    if (!failed) return
  }

  // 5. OpenAI (PAID - Last resort)
  if (hasOpenAIKey()) {
    try {
      console.log('[Chat] Using OpenAI (paid fallback)...')
      const stream = await openaiClient.chat.completions.create({
        model: OPENAI_COMPLETION_MODEL,
        messages: [
          {
            role: 'system',
            content: 'You are a real-time interview assistant. Answer questions concisely using candidate resume context.'
          },
          { role: 'user', content: prompt }
        ],
        stream: true
      })

      for await (const event of stream as any) {
        const text = event?.delta?.content ?? event?.choices?.[0]?.delta?.content
        if (typeof text === 'string') onChunk(text)
      }

      onComplete()
      return
    } catch (error) {
      console.warn('[Chat] OpenAI failed:', (error as Error).message)
    }
  }

  // 6. All providers failed - local mock response
  console.log('[Chat] All providers failed, using local mock response')
  const response = `I understand your question. Based on the available context, here's a concise answer for your interview preparation. Focus on demonstrating your experience and providing specific examples from your background.`
  const chunks = response.split(/(\s+)/).filter(Boolean)
  let index = 0

  const interval = setInterval(() => {
    if (index >= chunks.length) {
      clearInterval(interval)
      onComplete()
      return
    }
    onChunk(chunks[index])
    index += 1
  }, 120)
}

// ============================================
// VISION COMPLETIONS - Priority: Ollama LLaVA > Gemini > OpenAI
// ============================================

export async function streamVisionCompletion(
  prompt: string,
  base64Image: string,
  onChunk: (chunk: string) => void,
  onComplete: () => void,
  onError: (error: Error) => void
) {
  // 1. Ollama LLaVA (LOCAL - Free)
  if (useOllama()) {
    try {
      await streamOllamaCompletion(prompt, onChunk, onComplete, onError, base64Image)
      return
    } catch (error) {
      console.warn('[Vision] Ollama failed:', (error as Error).message)
    }
  }

  // 2. OpenAI GPT-4o (PAID - last resort)
  if (hasOpenAIKey()) {
    try {
      console.log('[Vision] Using OpenAI GPT-4o (paid)...')
      const stream = await openaiClient.chat.completions.create({
        model: OPENAI_COMPLETION_MODEL.includes('gpt-4o') ? OPENAI_COMPLETION_MODEL : 'gpt-4o-mini',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: base64Image } }
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
      return
    } catch (error) {
      onError(error instanceof Error ? error : new Error(String(error)))
      return
    }
  }

  onError(new Error('No vision provider available. Install Ollama with LLaVA model for free vision.'))
}
