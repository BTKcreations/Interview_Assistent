/**
 * Real WebSocket Integration Tests
 * Run: npx vitest run tests/realWebSocket.integration.ts
 */
process.env.NODE_ENV = 'test'
process.env.EMBEDDING_PROVIDER = 'local'

import fs from 'fs'
import path from 'path'
import WebSocket from 'ws'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { app, server } from '../src/backend/server'
import { resetResumeStore } from '../src/backend/vectorStore'

type WsMsg = { type: string; text?: string; message?: string }

function connectWs(url: string): Promise<{ ws: WebSocket; msgs: WsMsg[] }> {
  return new Promise((resolve, reject) => {
    const msgs: WsMsg[] = []
    const ws = new WebSocket(url)
    ws.on('open', () => resolve({ ws, msgs }))
    ws.on('error', reject)
    ws.on('message', (raw) => { try { msgs.push(JSON.parse(raw.toString())) } catch {} })
  })
}

function waitFor(msgs: WsMsg[], type: string, ms = 15000): Promise<WsMsg> {
  return new Promise((resolve, reject) => {
    const found = msgs.find((m) => m.type === type)
    if (found) return resolve(found)
    const iv = setInterval(() => {
      const f = msgs.find((m) => m.type === type)
      if (f) { clearInterval(iv); clearTimeout(to); resolve(f) }
    }, 50)
    const to = setTimeout(() => { clearInterval(iv); reject(new Error(`Timeout: ${type}`)) }, ms)
  })
}

describe('Real WebSocket integration', () => {
  let listener: import('http').Server | null = null
  let wsUrl = ''

  beforeAll(async () => {
    resetResumeStore()
    fs.mkdirSync(path.resolve(__dirname, '../uploads'), { recursive: true })
    listener = server.listen(0)
    await new Promise<void>((resolve, reject) => {
      if (!listener) return reject(new Error('bind failed'))
      listener.on('listening', resolve)
      listener.on('error', reject)
    })
    const addr = listener.address()
    const port = typeof addr === 'object' && addr?.port ? addr.port : 8080
    wsUrl = `ws://127.0.0.1:${port}`

    await request(app).post('/resume')
      .send({ text: 'Senior full-stack dev. Expert in React, Node.js, TypeScript, PostgreSQL, Redis. Led team of 5.' })
      .set('Content-Type', 'application/json')
  })

  afterAll(async () => {
    if (listener) { const l = listener; await new Promise<void>((r) => l.close(() => r())) }
  })

  it('sends welcome on connect', async () => {
    const { ws, msgs } = await connectWs(wsUrl)
    try {
      const w = await waitFor(msgs, 'welcome')
      expect(w.text).toContain('websocket')
    } finally { ws.close() }
  })

  it('responds to client-ready', async () => {
    const { ws, msgs } = await connectWs(wsUrl)
    try {
      await waitFor(msgs, 'welcome')
      ws.send(JSON.stringify({ type: 'client-ready' }))
      const s = await waitFor(msgs, 'status')
      expect(s.text).toContain('ready')
    } finally { ws.close() }
  })

  it('streams assistant response for a question', async () => {
    const { ws, msgs } = await connectWs(wsUrl)
    try {
      await waitFor(msgs, 'welcome')
      ws.send(JSON.stringify({ type: 'ask-question', question: 'What databases does the candidate know?' }))
      await waitFor(msgs, 'assistant-start')
      await waitFor(msgs, 'assistant-end', 20000)
      expect(msgs.filter((m) => m.type === 'assistant-chunk').length).toBeGreaterThan(0)
    } finally { ws.close() }
  }, 25000)

  it('acknowledges transcript text', async () => {
    const { ws, msgs } = await connectWs(wsUrl)
    try {
      await waitFor(msgs, 'welcome')
      ws.send(JSON.stringify({ type: 'transcript', text: 'microservices' }))
      const ack = await waitFor(msgs, 'transcript-ack')
      expect(ack.text).toContain('microservices')
    } finally { ws.close() }
  })

  it('returns error for invalid JSON', async () => {
    const { ws, msgs } = await connectWs(wsUrl)
    try {
      await waitFor(msgs, 'welcome')
      ws.send('not-json{{{')
      const err = await waitFor(msgs, 'error')
      expect(err.message).toContain('Invalid')
    } finally { ws.close() }
  })

  it('returns error for unknown event type', async () => {
    const { ws, msgs } = await connectWs(wsUrl)
    try {
      await waitFor(msgs, 'welcome')
      ws.send(JSON.stringify({ type: 'nonexistent' }))
      const err = await waitFor(msgs, 'error')
      expect(err.message).toContain('Unknown')
    } finally { ws.close() }
  })

  it('returns stt-error for chunk without active session', async () => {
    const { ws, msgs } = await connectWs(wsUrl)
    try {
      await waitFor(msgs, 'welcome')
      ws.send(JSON.stringify({ type: 'stt-chunk', audio: 'dGVzdA==' }))
      const err = await waitFor(msgs, 'stt-error')
      expect(err.text).toContain('not active')
    } finally { ws.close() }
  })

  it('handles stt-stop without active session', async () => {
    const { ws, msgs } = await connectWs(wsUrl)
    try {
      await waitFor(msgs, 'welcome')
      ws.send(JSON.stringify({ type: 'stt-stop' }))
      const s = await waitFor(msgs, 'stt-stopped')
      expect(s.text).toContain('stopped')
    } finally { ws.close() }
  })

  it('handles multiple concurrent clients', async () => {
    const conns = await Promise.all(Array.from({ length: 3 }, () => connectWs(wsUrl)))
    try {
      for (const c of conns) { await waitFor(c.msgs, 'welcome') }
      for (const c of conns) { c.ws.send(JSON.stringify({ type: 'client-ready' })) }
      for (const c of conns) { const s = await waitFor(c.msgs, 'status'); expect(s.type).toBe('status') }
    } finally { conns.forEach((c) => c.ws.close()) }
  })

  it('server survives client disconnect', async () => {
    const { ws, msgs } = await connectWs(wsUrl)
    await waitFor(msgs, 'welcome')
    ws.close()
    const { ws: ws2, msgs: msgs2 } = await connectWs(wsUrl)
    const w = await waitFor(msgs2, 'welcome')
    expect(w.type).toBe('welcome')
    ws2.close()
  })
})
