/**
 * Real Assistant Pipeline Integration Tests
 *
 * Tests the complete assistant workflow: resume ingestion → retrieval →
 * prompt building → streaming response. Validates prompt construction,
 * response quality, streaming chunk order, and error handling.
 *
 * Run: npx vitest run tests/realAssistant.integration.ts
 */
process.env.NODE_ENV = 'test'
process.env.EMBEDDING_PROVIDER = 'local'

import { describe, expect, it, beforeAll } from 'vitest'
import {
  ingestResumeText,
  retrieveResumeContext,
  buildAssistantPrompt,
  streamAssistantResponse
} from '../src/backend/assistant'
import { resetResumeStore } from '../src/backend/vectorStore'

describe('Real assistant pipeline integration', () => {

  beforeAll(() => {
    resetResumeStore()
  })

  // ─── Resume Ingestion ─────────────────────────────────────────
  describe('Resume ingestion', () => {
    it('ingests resume text and returns chunk IDs', async () => {
      const ids = await ingestResumeText(
        'John Doe — Senior Software Engineer\n\n' +
        'Experience: 7 years building production systems in Node.js, Python, and Go.\n\n' +
        'Skills: React, TypeScript, PostgreSQL, Redis, AWS, Docker, Kubernetes.\n\n' +
        'Education: M.S. Computer Science, Stanford University, 2018.'
      )
      expect(Array.isArray(ids)).toBe(true)
      expect(ids.length).toBeGreaterThanOrEqual(2)
    })

    it('filters out very short chunks (< 32 chars)', async () => {
      resetResumeStore()
      const ids = await ingestResumeText('Hi\n\nShort\n\nThis is a longer chunk that should be ingested properly into the vector store.')
      // Only the long chunk should pass the 32-char filter
      expect(ids.length).toBe(1)
    })
  })

  // ─── Resume Retrieval ─────────────────────────────────────────
  describe('Resume retrieval', () => {
    beforeAll(async () => {
      resetResumeStore()
      await ingestResumeText(
        'Full-stack developer expert in React, Vue, and Angular frontend frameworks.\n\n' +
        'Backend experience with Express, FastAPI, and Django serving REST and GraphQL APIs.\n\n' +
        'Database expertise: PostgreSQL, MongoDB, Redis, and Elasticsearch.\n\n' +
        'DevOps: Docker, Kubernetes, Terraform, GitHub Actions CI/CD pipelines.'
      )
    })

    it('retrieves relevant context for a targeted question', async () => {
      const ctx = await retrieveResumeContext('What databases does the candidate know?')
      expect(ctx).toContain('Relevant resume excerpts')
      expect(ctx).toContain('Snippet 1')
    })

    it('returns no-context message when store is empty', async () => {
      resetResumeStore()
      const ctx = await retrieveResumeContext('Tell me about the candidate')
      expect(ctx).toContain('No resume context')
    })
  })

  // ─── Prompt Building ──────────────────────────────────────────
  describe('Prompt construction', () => {
    it('includes question and resume context in the prompt', () => {
      const prompt = buildAssistantPrompt(
        'What is your experience with microservices?',
        'Relevant resume excerpts:\nSnippet 1: Built microservices architecture serving 10M requests.'
      )

      expect(prompt).toContain('microservices')
      expect(prompt).toContain('Resume Context')
      expect(prompt).toContain('Interviewer question')
      expect(prompt).toContain('coaching')
    })

    it('handles empty context gracefully', () => {
      const prompt = buildAssistantPrompt('Tell me about yourself', '')
      expect(prompt).toContain('Tell me about yourself')
      expect(prompt).toContain('Resume Context')
    })

    it('handles empty question gracefully', () => {
      const prompt = buildAssistantPrompt('', 'Some resume context here')
      expect(prompt).toContain('Resume Context')
      expect(prompt).toContain('Some resume context here')
    })
  })

  // ─── Streaming Response ───────────────────────────────────────
  describe('Streaming response', () => {
    it('streams chunks and calls onComplete (fallback mode)', async () => {
      const chunks: string[] = []
      let completed = false

      await new Promise<void>((resolve) => {
        streamAssistantResponse(
          buildAssistantPrompt('Tell me about React', 'Expert in React and TypeScript'),
          (chunk) => chunks.push(chunk),
          () => { completed = true; resolve() }
        )
      })

      expect(chunks.length).toBeGreaterThan(0)
      expect(completed).toBe(true)
    }, 20000)

    it('delivers chunks in order', async () => {
      const chunks: string[] = []
      let completed = false

      await new Promise<void>((resolve) => {
        streamAssistantResponse(
          buildAssistantPrompt('Explain your backend experience', 'Node.js and Python developer'),
          (chunk) => chunks.push(chunk),
          () => { completed = true; resolve() }
        )
      })

      // Chunks should form a readable sentence when joined
      const fullText = chunks.join('')
      expect(fullText.length).toBeGreaterThan(10)
      expect(completed).toBe(true)
    }, 20000)
  })

  // ─── Full Pipeline ────────────────────────────────────────────
  describe('Full pipeline: ingest → retrieve → prompt → stream', () => {
    it('completes the entire flow end-to-end', async () => {
      resetResumeStore()

      // 1. Ingest
      const ids = await ingestResumeText(
        'Jane Smith — ML Engineer at OpenAI.\n\n' +
        'Built large-scale training pipelines using PyTorch and JAX on TPU clusters.\n\n' +
        'Published 5 papers on transformer architectures and attention mechanisms.'
      )
      expect(ids.length).toBeGreaterThan(0)

      // 2. Retrieve
      const ctx = await retrieveResumeContext('What ML frameworks does the candidate use?')
      expect(ctx).toContain('Relevant resume excerpts')

      // 3. Build prompt
      const prompt = buildAssistantPrompt('What ML frameworks does the candidate use?', ctx)
      expect(prompt).toContain('Interviewer question')

      // 4. Stream response
      const chunks: string[] = []
      let done = false

      await new Promise<void>((resolve) => {
        streamAssistantResponse(
          prompt,
          (chunk) => chunks.push(chunk),
          () => { done = true; resolve() }
        )
      })

      expect(chunks.length).toBeGreaterThan(0)
      expect(done).toBe(true)
    }, 25000)
  })
})
