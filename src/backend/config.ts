import dotenv from 'dotenv'
import path from 'path'
import fs from 'fs'

// In production, look for .env in multiple locations
const candidates: string[] = []

// 1. If DOTENV_CONFIG_PATH is set by Electron main process, use it
if (process.env.DOTENV_CONFIG_PATH) {
  candidates.push(process.env.DOTENV_CONFIG_PATH)
}

// 2. Check relative to process.cwd()
candidates.push(path.join(process.cwd(), '.env'))

// 3. In packaged app, check app.asar.unpacked root
if (process.env.PORTABLE_EXECUTABLE_DIR) {
  const exeDir = process.env.PORTABLE_EXECUTABLE_DIR
  candidates.push(path.join(exeDir, '.env'))
  candidates.push(path.join(exeDir, 'resources', '.env'))
}

// 4. Check process.argv[1] (the main.js path) to derive app root
if (process.argv[1]) {
  const mainDir = path.dirname(process.argv[1])
  candidates.push(path.join(mainDir, '.env'))
  candidates.push(path.join(mainDir, '..', '..', '.env'))
  candidates.push(path.join(mainDir, '..', '..', '..', '.env'))
}

let envPath = ''
for (const p of candidates) {
  try {
    if (fs.existsSync(p)) {
      envPath = p
      break
    }
  } catch {}
}

if (envPath) {
  dotenv.config({ path: envPath })
  console.log('[config] Loaded .env from:', envPath)
} else {
  dotenv.config()
  console.log('[config] .env not found. Searched:', candidates)
}

// ============================================
// FREE LLM PROVIDERS (Priority: Groq > Gemini > Ollama > Local)
// ============================================

// Groq (FASTEST - Primary)
export const GROQ_API_KEY = (process.env.GROQ_API_KEY ?? '') as string
export const GROQ_CHAT_MODEL = (process.env.GROQ_CHAT_MODEL ?? 'llama-3.3-70b-versatile') as string

// Google Gemini (SMARTEST - Secondary)
export const GOOGLE_AI_API_KEY = (process.env.GOOGLE_AI_API_KEY ?? '') as string
export const GOOGLE_AI_MODEL = (process.env.GOOGLE_AI_MODEL ?? 'gemini-2.5-flash') as string

// OpenRouter (MOST MODELS - Tertiary)
export const OPENROUTER_API_KEY = (process.env.OPENROUTER_API_KEY ?? '') as string
export const OPENROUTER_CHAT_MODEL = (process.env.OPENROUTER_CHAT_MODEL ?? 'meta-llama/llama-3.1-8b-instruct:free') as string

// Ollama (LOCAL - Unlimited fallback)
export const USE_OLLAMA = (process.env.USE_OLLAMA ?? 'false') === 'true'
export const OLLAMA_API_URL = (process.env.OLLAMA_API_URL ?? 'http://127.0.0.1:11434') as string
export const OLLAMA_MODEL = (process.env.OLLAMA_MODEL ?? 'llama3.1:8b') as string

// OpenAI (LAST RESORT - requires paid key)
export const OPENAI_API_KEY = (process.env.OPENAI_API_KEY ?? '') as string
export const OPENAI_EMBEDDING_MODEL = (process.env.OPENAI_EMBEDDING_MODEL ?? 'text-embedding-3-small') as string
export const OPENAI_COMPLETION_MODEL = (process.env.OPENAI_COMPLETION_MODEL ?? 'gpt-4o-mini') as string

// ============================================
// FREE EMBEDDING PROVIDERS (Priority: Local > HuggingFace > Ollama > OpenAI)
// ============================================

export const EMBEDDING_PROVIDER = (process.env.EMBEDDING_PROVIDER ?? 'local') as string
export const HUGGINGFACE_API_KEY = (process.env.HUGGINGFACE_API_KEY ?? '') as string
export const HUGGINGFACE_EMBEDDING_MODEL = (process.env.HUGGINGFACE_EMBEDDING_MODEL ?? 'sentence-transformers/all-MiniLM-L6-v2') as string

// ============================================
// FREE STT PROVIDERS (Priority: Groq Whisper > Deepgram > OpenAI Whisper)
// ============================================

export const DEEPGRAM_API_KEY = (process.env.DEEPGRAM_API_KEY ?? '') as string
export const DEEPGRAM_LANGUAGE = (process.env.DEEPGRAM_LANGUAGE ?? 'en-US') as string
export const DEEPGRAM_MODEL = (process.env.DEEPGRAM_MODEL ?? 'nova-2') as string

// ============================================
// BACKEND
// ============================================

export const BACKEND_PORT = parseInt(process.env.BACKEND_PORT ?? '8080', 10)
