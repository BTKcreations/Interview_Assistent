export const OPENAI_API_KEY = (process.env.OPENAI_API_KEY ?? 'your-openai-api-key') as string
export const OPENAI_EMBEDDING_MODEL = 'text-embedding-3-small'
export const OPENAI_COMPLETION_MODEL = 'gpt-4o-mini'

export const EMBEDDING_PROVIDER = 'local' as string
export const HUGGINGFACE_API_KEY = (process.env.HUGGINGFACE_API_KEY ?? '') as string
export const HUGGINGFACE_EMBEDDING_MODEL = 'sentence-transformers/all-MiniLM-L6-v2'

export const USE_OLLAMA = true
export const OLLAMA_API_URL = 'http://127.0.0.1:11434'
export const OLLAMA_MODEL = 'gemma4:31b-cloud'

export const DEEPGRAM_API_KEY = (process.env.DEEPGRAM_API_KEY ?? 'your-deepgram-api-key') as string
export const DEEPGRAM_LANGUAGE = 'en-US'
export const DEEPGRAM_MODEL = 'nova-2'

export const GROQ_API_KEY = (process.env.GROQ_API_KEY ?? '') as string
export const BACKEND_PORT = 8080
