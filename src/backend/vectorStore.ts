import { createEmbedding, hasEmbeddingProvider, createLocalEmbedding } from './openaiClient'

type ResumeChunk = {
  id: string
  fileId: string // Link to original document
  text: string
  embedding: number[]
}

type DocumentMetadata = {
  id: string
  name: string
  size: number
  type: string
  timestamp: number
}

const resumeChunks: ResumeChunk[] = []
const documents: DocumentMetadata[] = []

const createId = () => Math.random().toString(36).slice(2, 10)

// Storage limit: 10MB
const MAX_STORAGE_BYTES = 10 * 1024 * 1024 

export function getStorageStats() {
  const used = documents.reduce((acc, doc) => acc + doc.size, 0)
  return {
    used,
    limit: MAX_STORAGE_BYTES,
    percent: Math.min(100, (used / MAX_STORAGE_BYTES) * 100),
    count: documents.length
  }
}

export function listDocuments() {
  return documents
}

export function deleteDocument(id: string) {
  const docIndex = documents.findIndex(d => d.id === id)
  if (docIndex !== -1) {
    documents.splice(docIndex, 1)
    // Remove all chunks associated with this file
    for (let i = resumeChunks.length - 1; i >= 0; i--) {
      if (resumeChunks[i].fileId === id) {
        resumeChunks.splice(i, 1)
      }
    }
    return true
  }
  return false
}

export async function ingestResumeText(text: string, fileName = 'manual_entry.txt', fileSize?: number) {
  const fileId = createId()
  const actualSize = fileSize ?? Buffer.byteLength(text, 'utf8')

  // Check storage limit
  const stats = getStorageStats()
  if (stats.used + actualSize > MAX_STORAGE_BYTES) {
    throw new Error('Storage limit exceeded (10MB maximum)')
  }

  const chunks = text
    .split(/\n{2,}/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 32)

  for (const chunkText of chunks) {
    const embedding = hasEmbeddingProvider()
      ? await createEmbedding(chunkText)
      : createLocalEmbedding(chunkText)

    resumeChunks.push({
      id: createId(),
      fileId,
      text: chunkText,
      embedding
    })
  }

  documents.push({
    id: fileId,
    name: fileName,
    size: actualSize,
    type: fileName.endsWith('.pdf') ? 'application/pdf' : 'text/plain',
    timestamp: Date.now()
  })

  return fileId
}

export async function retrieveResumeContext(question: string) {
  if (resumeChunks.length === 0) {
    return 'No knowledge context is available yet. Upload documents or paste your resume to enable personalized responses.'
  }

  const queryEmbedding = hasEmbeddingProvider() ? await createEmbedding(question) : createLocalEmbedding(question)

  const scored = resumeChunks
    .map((chunk) => ({
      chunk,
      score: cosineSimilarity(queryEmbedding, chunk.embedding)
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5) // Get more context for multi-doc

  const topText = scored.map((entry, index) => `[Source: ${documents.find(d => d.id === entry.chunk.fileId)?.name || 'Unknown'}] ${entry.chunk.text}`).join('\n\n')

  return `Relevant context from your Knowledge Vault:\n${topText}`
}

export function hasResumeContext() {
  return resumeChunks.length > 0
}

export function resetResumeStore() {
  resumeChunks.length = 0
  documents.length = 0
}

function cosineSimilarity(a: number[], b: number[]) {
  const length = Math.min(a.length, b.length)
  if (length === 0) return 0
  let dot = 0
  for (let i = 0; i < length; i += 1) {
    dot += a[i] * b[i]
  }
  return dot
}
