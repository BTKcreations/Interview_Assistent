/**
 * Real API Integration Tests
 *
 * Tests all HTTP REST endpoints against a real running backend server.
 * These tests spin up the server on a random port and exercise
 * health checks, resume ingestion (text + file upload), error handling,
 * and CORS headers.
 *
 * Run: npx vitest run tests/realApi.integration.ts
 */
process.env.NODE_ENV = 'test'
process.env.EMBEDDING_PROVIDER = 'local'

import fs from 'fs'
import path from 'path'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { app, server } from '../src/backend/server'
import { resetResumeStore } from '../src/backend/vectorStore'

describe('Real API integration tests', () => {
  let listener: import('http').Server | null = null
  let baseUrl = ''

  beforeAll(async () => {
    resetResumeStore()
    const uploadsDir = path.resolve(__dirname, '../uploads')
    fs.mkdirSync(uploadsDir, { recursive: true })

    listener = server.listen(0)
    await new Promise<void>((resolve, reject) => {
      if (!listener) return reject(new Error('Unable to bind server'))
      listener.on('listening', resolve)
      listener.on('error', reject)
    })

    const address = listener.address()
    const port = typeof address === 'object' && address?.port ? address.port : 8080
    baseUrl = `http://127.0.0.1:${port}`
  })

  afterAll(async () => {
    if (listener) {
      const active = listener
      await new Promise<void>((resolve) => active.close(() => resolve()))
    }
  })

  // ─── Health Check ──────────────────────────────────────────────
  describe('GET /health', () => {
    it('returns 200 with ok status', async () => {
      const res = await request(app).get('/health')
      expect(res.status).toBe(200)
      expect(res.body).toEqual({ status: 'ok', service: 'backend' })
    })

    it('includes correct content-type header', async () => {
      const res = await request(app).get('/health')
      expect(res.headers['content-type']).toMatch(/application\/json/)
    })
  })

  // ─── Resume Text Ingestion ─────────────────────────────────────
  describe('POST /resume', () => {
    it('accepts valid resume text and returns documentIds', async () => {
      const res = await request(app)
        .post('/resume')
        .send({ text: 'Senior software engineer with 5 years of experience in React, Node.js, TypeScript, and PostgreSQL. Built distributed systems serving millions of users.' })
        .set('Content-Type', 'application/json')

      expect(res.status).toBe(200)
      expect(res.body.status).toBe('accepted')
      expect(Array.isArray(res.body.documentIds)).toBe(true)
      expect(res.body.documentIds.length).toBeGreaterThan(0)
      expect(res.body.message).toContain('ingested')
    })

    it('rejects empty text with 400', async () => {
      const res = await request(app)
        .post('/resume')
        .send({ text: '' })
        .set('Content-Type', 'application/json')

      expect(res.status).toBe(400)
      expect(res.body.status).toBe('error')
      expect(res.body.message).toContain('required')
    })

    it('rejects missing text field with 400', async () => {
      const res = await request(app)
        .post('/resume')
        .send({})
        .set('Content-Type', 'application/json')

      expect(res.status).toBe(400)
      expect(res.body.status).toBe('error')
    })

    it('rejects whitespace-only text with 400', async () => {
      const res = await request(app)
        .post('/resume')
        .send({ text: '   \n\n   ' })
        .set('Content-Type', 'application/json')

      expect(res.status).toBe(400)
      expect(res.body.status).toBe('error')
    })

    it('rejects non-string text with 400', async () => {
      const res = await request(app)
        .post('/resume')
        .send({ text: 12345 })
        .set('Content-Type', 'application/json')

      expect(res.status).toBe(400)
      expect(res.body.status).toBe('error')
    })

    it('handles large resume text', async () => {
      const largeText = 'Full-stack developer with experience in many technologies. '.repeat(200)

      const res = await request(app)
        .post('/resume')
        .send({ text: largeText })
        .set('Content-Type', 'application/json')

      expect(res.status).toBe(200)
      expect(res.body.status).toBe('accepted')
      expect(res.body.documentIds.length).toBeGreaterThan(0)
    })
  })

  // ─── Resume File Upload ────────────────────────────────────────
  describe('POST /resume/upload', () => {
    it('uploads a text file and extracts content', async () => {
      const tempFile = path.join(__dirname, 'test-resume-upload.txt')
      fs.writeFileSync(tempFile, 'Machine Learning engineer with expertise in PyTorch, TensorFlow, and large language model fine-tuning. Published 3 papers on NLP.')

      try {
        const res = await request(app)
          .post('/resume/upload')
          .attach('resume', tempFile)

        expect(res.status).toBe(200)
        expect(res.body.status).toBe('accepted')
        expect(Array.isArray(res.body.documentIds)).toBe(true)
      } finally {
        if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile)
      }
    })

    it('rejects request with no file attached', async () => {
      const res = await request(app)
        .post('/resume/upload')
        .send()

      expect(res.status).toBe(400)
      expect(res.body.status).toBe('error')
      expect(res.body.message).toContain('No resume file')
    })

    it('handles an empty text file gracefully', async () => {
      const tempFile = path.join(__dirname, 'test-empty-resume.txt')
      fs.writeFileSync(tempFile, '')

      try {
        const res = await request(app)
          .post('/resume/upload')
          .attach('resume', tempFile)

        expect(res.status).toBe(400)
        expect(res.body.status).toBe('error')
        expect(res.body.message).toContain('readable text')
      } finally {
        if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile)
      }
    })
  })

  // ─── CORS Headers ─────────────────────────────────────────────
  describe('CORS', () => {
    it('includes access-control-allow-origin header', async () => {
      const res = await request(app).get('/health')
      // cors() with no options allows all origins
      expect(res.headers['access-control-allow-origin']).toBeDefined()
    })
  })

  // ─── Concurrent Requests ──────────────────────────────────────
  describe('Concurrent requests', () => {
    it('handles multiple simultaneous resume ingestions', async () => {
      const requests = Array.from({ length: 5 }, (_, i) =>
        request(app)
          .post('/resume')
          .send({ text: `Concurrent candidate #${i} with skills in JavaScript, Python, and cloud computing on AWS and GCP infrastructure.` })
          .set('Content-Type', 'application/json')
      )

      const results = await Promise.all(requests)

      for (const res of results) {
        expect(res.status).toBe(200)
        expect(res.body.status).toBe('accepted')
      }
    })
  })

  // ─── Unknown Routes ───────────────────────────────────────────
  describe('Unknown routes', () => {
    it('returns 404 for undefined endpoints', async () => {
      const res = await request(app).get('/nonexistent')
      expect(res.status).toBe(404)
    })

    it('returns 404 for wrong HTTP method on /health', async () => {
      const res = await request(app).post('/health')
      expect(res.status).toBe(404)
    })
  })
})
