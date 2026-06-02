process.env.EMBEDDING_PROVIDER = 'local'

import fs from 'fs'
import path from 'path'
import WebSocket from 'ws'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { app, server } from '../src/backend/server'
import { resetResumeStore } from '../src/backend/vectorStore'

describe('End-to-end assistant workflow', () => {
  let listener: import('http').Server | null = null
  let wsUrl = ''

  beforeAll(async () => {
    resetResumeStore()
    const uploadsDirectory = path.resolve(__dirname, '../uploads')
    fs.mkdirSync(uploadsDirectory, { recursive: true })

    listener = server.listen(0)
    await new Promise<void>((resolve, reject) => {
      if (!listener) {
        reject(new Error('Unable to bind server listener'))
        return
      }
      listener.on('listening', resolve)
      listener.on('error', reject)
    })

    const address = listener.address()
    const port = typeof address === 'object' && address?.port ? address.port : 8080
    wsUrl = `ws://127.0.0.1:${port}`
  })

  afterAll(async () => {
    if (listener) {
      const activeListener = listener
      await new Promise<void>((resolve) => activeListener.close(() => resolve()))
    }
  })

  it('should complete a full resume upload and question-answer flow', async () => {
    const resumeResponse = await request(app)
      .post('/resume')
      .send({ text: 'Senior backend developer with production experience in Node.js, TypeScript, and WebSockets.' })
      .set('Content-Type', 'application/json')

    expect(resumeResponse.status).toBe(200)
    expect(resumeResponse.body.status).toBe('accepted')
    expect(resumeResponse.body.documentIds).toBeTruthy()

    const received: any[] = []

    await new Promise<void>((resolve, reject) => {
      const client = new WebSocket(wsUrl)

      client.on('open', () => {
        client.send(JSON.stringify({ type: 'client-ready' }))
        client.send(JSON.stringify({ type: 'ask-question', question: 'What database experience does this candidate have?' }))
      })

      client.on('message', (data) => {
        const payload = JSON.parse(data.toString())
        received.push(payload)

        if (payload.type === 'assistant-end') {
          client.close()
          resolve()
        }
      })

      client.on('error', reject)
      client.on('close', () => {
        if (!received.some((item) => item.type === 'assistant-end')) {
          reject(new Error('Assistant response did not complete'))
        }
      })
    })

    expect(received.some((item) => item.type === 'assistant-start')).toBe(true)
    expect(received.some((item) => item.type === 'assistant-chunk')).toBe(true)
    expect(received.some((item) => item.type === 'assistant-end')).toBe(true)
    expect(received.some((item) => item.text?.includes('database') || item.text?.includes('experience'))).toBe(true)
  }, 20000)
})
