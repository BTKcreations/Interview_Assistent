process.env.EMBEDDING_PROVIDER = 'local'

import { describe, expect, it } from 'vitest'
import { ingestResumeText, retrieveResumeContext } from '../src/backend/vectorStore'

describe('Vector store workflow', () => {
  it('ingests resume text and retrieves relevant context locally', async () => {
    const ids = await ingestResumeText('Full-stack developer skilled in React, Node.js, and PostgreSQL.')

    expect(ids.length).toBeGreaterThan(0)

    const context = await retrieveResumeContext('Tell me about the candidate\'s database experience')
    expect(context).toContain('Relevant resume excerpts:')
    expect(context).toContain('PostgreSQL')
  })
})
