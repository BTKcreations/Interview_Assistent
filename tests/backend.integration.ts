process.env.EMBEDDING_PROVIDER = 'local'

import fs from 'fs'
import path from 'path'
import request from 'supertest'
import WebSocket from 'ws'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { app, server } from '../src/backend/server'

describe('Backend workflow integration', () => {
  let listener: import('http').Server | null = null
  let baseUrl = ''
  let wsUrl = ''

  beforeAll(async () => {
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
    baseUrl = `http://127.0.0.1:${port}`
    wsUrl = `ws://127.0.0.1:${port}`
  })

  afterAll(async () => {
    if (listener) {
      const activeListener = listener
      await new Promise<void>((resolve) => activeListener.close(() => resolve()))
    }
  })

  it('should respond to health checks', async () => {
    const response = await request(app).get('/health')
    expect(response.status).toBe(200)
    expect(response.body).toEqual({ status: 'ok', service: 'backend' })
  })

  it('should ingest resume text successfully', async () => {
    const response = await request(app)
      .post('/resume')
      .send({ text: 'Experienced software engineer with React and Node.js expertise.' })
      .set('Content-Type', 'application/json')

    expect(response.status).toBe(200)
    expect(response.body.status).toBe('accepted')
    expect(response.body.documentIds).toBeTruthy()
  })

  it('should upload a resume file successfully', async () => {
    const tempFile = path.join(__dirname, 'temp-resume.txt')
    fs.writeFileSync(tempFile, 'Resume upload test content: Typescript, Electron, and backend workflows.')

    const response = await request(app)
      .post('/resume/upload')
      .attach('resume', tempFile)

    fs.unlinkSync(tempFile)

    expect(response.status).toBe(200)
    expect(response.body.status).toBe('accepted')
    expect(response.body.documentIds).toBeDefined()
  })

  it('should accept websocket connections and handshake successfully', async () => {
    const received: any[] = []

    await new Promise<void>((resolve, reject) => {
      const client = new WebSocket(wsUrl)

      client.on('open', () => {
        client.send(JSON.stringify({ type: 'client-ready' }))
      })

      client.on('message', (data) => {
        const payload = JSON.parse(data.toString())
        received.push(payload)

        if (payload.type === 'status') {
          client.close()
          resolve()
        }
      })

      client.on('error', reject)
      client.on('close', () => {
        if (!received.some((item) => item.type === 'status')) {
          reject(new Error('Did not receive websocket status event'))
        }
      })
    })

    expect(received.some((payload) => payload.type === 'welcome')).toBe(true)
    expect(received.some((payload) => payload.type === 'status')).toBe(true)
  })
})
