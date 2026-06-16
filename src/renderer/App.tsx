import React, { useState, useEffect, useRef, useCallback } from 'react'
import './styles.css'

const API_BASE = 'http://localhost:8080'
const WS_URL = 'ws://localhost:8080'

type HistoryItem = {
  question: string
  answer: string
  timestamp: string
}

type DocumentItem = {
  id: string
  name: string
  size: number
}

const MarkdownRenderer = ({ content }: { content: string }) => {
  const lines = content.split('\n')
  const renderedLines: React.ReactNode[] = []
  let inCodeBlock = false
  let codeBuffer: string[] = []
  let listItems: React.ReactNode[] = []

  const flushList = () => {
    if (listItems.length > 0) {
      renderedLines.push(<ul key={`ul-${renderedLines.length}`}>{listItems}</ul>)
      listItems = []
    }
  }

  lines.forEach((line, i) => {
    if (line.trim().startsWith('```')) {
      flushList()
      if (inCodeBlock) {
        renderedLines.push(<pre key={`code-${i}`}><code>{codeBuffer.join('\n')}</code></pre>)
        codeBuffer = []
        inCodeBlock = false
      } else inCodeBlock = true
      return
    }

    if (inCodeBlock) { codeBuffer.push(line); return }
    if (line.startsWith('### ')) { flushList(); renderedLines.push(<h2 key={i}>{line.slice(4)}</h2>) }
    else if (line.startsWith('# ')) { flushList(); renderedLines.push(<h1 key={i}>{line.slice(2)}</h1>) }
    else if (line.trim().startsWith('* ') || line.trim().startsWith('- ')) {
      listItems.push(<li key={i}>{line.trim().slice(2)}</li>)
    }
    else if (line.trim() === '') { flushList(); renderedLines.push(<br key={i} />) }
    else {
      flushList()
      const parts = line.split(/(\*\*.*?\*\*|`.*?`)/)
      const formatted = parts.map((part, pi) => {
        if (part.startsWith('**') && part.endsWith('**')) return <strong key={pi}>{part.slice(2, -2)}</strong>
        if (part.startsWith('`') && part.endsWith('`')) return <code key={pi}>{part.slice(1, -1)}</code>
        return part
      })
      renderedLines.push(<p key={i}>{formatted}</p>)
    }
  })

  flushList()
  if (inCodeBlock) renderedLines.push(<pre key="code-last"><code>{codeBuffer.join('\n')}</code></pre>)
  return <div className="markdown">{renderedLines}</div>
}

export default function App() {
  const [question, setQuestion] = useState('')
  const [isRecording, setIsRecording] = useState(false)
  const [resumeText, setResumeText] = useState('')
  const [resumeStatus, setResumeStatus] = useState('')
  const [showResume, setShowResume] = useState(false)
  const [isStreaming, setIsStreaming] = useState(false)
  const [assistantResponse, setAssistantResponse] = useState('')
  const [stealthMode, setStealthMode] = useState(true)
  const [documents, setDocuments] = useState<DocumentItem[]>([])
  const [storageStats, setStorageStats] = useState({ used: 0, limit: 10 * 1024 * 1024, percent: 0, count: 0 })
  const [showSettings, setShowSettings] = useState(false)
  const [toast, setToast] = useState('')
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [lastQuestion, setLastQuestion] = useState('')
  const [lastTranscript, setLastTranscript] = useState('')
  const [isConnected, setIsConnected] = useState(false)
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadStage, setUploadStage] = useState('')
  const [detectedQuestion, setDetectedQuestion] = useState<string | null>(null)
  const [showHowTo, setShowHowTo] = useState(true)
  const [errorBanner, setErrorBanner] = useState('')

  const socketRef = useRef<WebSocket | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const animFrameRef = useRef<number>(0)
  const isRecordingRef = useRef(false)
  const currentRequestRef = useRef<{ question: string; answer: string } | null>(null)
  const sendQuestionRef = useRef<(overrideQuestion?: string, clearInput?: boolean) => void>(() => {})
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const panelContentRef = useRef<HTMLDivElement>(null)
  const uploadInputRef = useRef<HTMLInputElement>(null)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (panelContentRef.current) {
      panelContentRef.current.scrollTop = panelContentRef.current.scrollHeight
    }
  }, [assistantResponse, isStreaming])

  useEffect(() => {
    const api = (window as any).electronAPI
    if (api) {
      const offMic = api.onShortcutToggleMic(() => {
        if (isRecording) stopTranscription()
        else startTranscription()
      })
      const offSnapshot = api.onShortcutSnapshot(() => takeSnapshot())
      const offFocus = api.onShortcutFocusInput(() => {
        if (inputRef.current) {
          inputRef.current.focus()
          inputRef.current.select()
        }
      })

      return () => {
        if (offMic) offMic()
        if (offSnapshot) offSnapshot()
        if (offFocus) offFocus()
      }
    }
  }, [isRecording])

  useEffect(() => {
    if (!toast) return
    const id = window.setTimeout(() => setToast(''), 3000)
    return () => window.clearTimeout(id)
  }, [toast])

  useEffect(() => {
    const api = (window as any).electronAPI
    if (!api?.resizeWindow) return

    const resize = () => {
      requestAnimationFrame(() => {
        const root = document.getElementById('root')
        if (root) {
          const h = root.scrollHeight
          if (h > 0) api.resizeWindow(h + 20)
        }
      })
    }

    const timer = setTimeout(resize, 100)
    const observer = new ResizeObserver(resize)
    observer.observe(document.documentElement)
    const mutationObserver = new MutationObserver(resize)
    mutationObserver.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true })

    return () => {
      clearTimeout(timer)
      observer.disconnect()
      mutationObserver.disconnect()
    }
  }, [assistantResponse, showHowTo, showResume, showSettings, detectedQuestion])

  const showToast = useCallback((message: string) => {
    setToast(message)
  }, [])

  const addHistory = useCallback((questionText: string, answerText: string) => {
    const trimmedAnswer = answerText.trim() || 'No answer was generated.'
    setHistory(prev => [{ question: questionText, answer: trimmedAnswer, timestamp: new Date().toLocaleTimeString() }, ...prev].slice(0, 10))
  }, [])

  const detectQuestionCandidate = (text: string) => {
    const questionPatterns = [
      'tell me about', 'what is your', 'how would you', 'can you explain',
      'describe a', 'experience with', 'why should we', 'your background',
      'what are your', 'how do you', 'in your opinion', 'where do you see',
      'give me an example'
    ]
    const lower = text.toLowerCase()
    return questionPatterns.some(p => lower.includes(p)) || text.includes('?')
  }

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'm') {
        event.preventDefault()
        if (isRecording) stopTranscription()
        else startTranscription()
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        inputRef.current?.focus()
      }
      if (event.key === 'Escape') {
        setDetectedQuestion(null)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isRecording])

  useEffect(() => {
    if (detectedQuestion) {
      showToast('Detected a question. Confirm before sending.')
    }
  }, [detectedQuestion, showToast])

  const connectWebSocket = useCallback(() => {
    if (socketRef.current?.readyState === WebSocket.OPEN) return

    const socket = new WebSocket(WS_URL)
    socketRef.current = socket

    socket.onopen = () => {
      setIsConnected(true)
      socket.send(JSON.stringify({ type: 'client-ready' }))
    }

    socket.onclose = () => {
      setIsConnected(false)
      reconnectTimerRef.current = setTimeout(connectWebSocket, 3000)
    }

    socket.onerror = () => {
      setIsConnected(false)
    }

    socket.onmessage = (event) => {
      let payload
      try {
        payload = JSON.parse(event.data)
      } catch {
        return
      }

      if (payload.type === 'assistant-start') {
        setIsStreaming(true)
        setAssistantResponse('')
      } else if (payload.type === 'assistant-chunk') {
        setAssistantResponse(prev => {
          const next = prev + (payload.text ?? '')
          if (currentRequestRef.current) currentRequestRef.current.answer = next
          return next
        })
      } else if (payload.type === 'assistant-end') {
        setIsStreaming(false)
        if (currentRequestRef.current) {
          addHistory(currentRequestRef.current.question, currentRequestRef.current.answer)
          currentRequestRef.current = null
        }
      } else if (payload.type === 'stt-result') {
        const text = (payload.text ?? '').trim()
        if (!text) return
        setLastTranscript(text)
        setQuestion(prev => (prev.trim() ? `${prev.trim()} ${text}` : text))
        if (detectQuestionCandidate(text)) {
          setDetectedQuestion(text)
        }
      } else if (payload.type === 'detected-question') {
        const text = (payload.text ?? '').trim()
        if (text) setDetectedQuestion(text)
      } else if (payload.type === 'stt-error') {
        setIsRecording(false)
      } else if (payload.type === 'ask-question') {
        if (typeof payload.question === 'string' && payload.question.trim()) {
          sendQuestionRef.current(payload.question, true)
        }
      }
    }
  }, [addHistory])

  useEffect(() => {
    connectWebSocket()
    return () => {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
      socketRef.current?.close()
    }
  }, [connectWebSocket])

  const startTranscription = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      mediaStreamRef.current = stream

      const audioCtx = new AudioContext()
      audioCtxRef.current = audioCtx
      const source = audioCtx.createMediaStreamSource(stream)
      const analyser = audioCtx.createAnalyser()
      analyser.fftSize = 256
      source.connect(analyser)
      const dataArray = new Uint8Array(analyser.frequencyBinCount)

      const updateLevel = () => {
        if (!mediaStreamRef.current) return
        analyser.getByteFrequencyData(dataArray)
        animFrameRef.current = requestAnimationFrame(updateLevel)
      }
      animFrameRef.current = requestAnimationFrame(updateLevel)

      const startRecordingBurst = () => {
        if (!mediaStreamRef.current || !isRecordingRef.current) return

        const recorder = new MediaRecorder(mediaStreamRef.current, { mimeType: 'audio/webm' })
        mediaRecorderRef.current = recorder

        recorder.ondataavailable = async (e) => {
          if (socketRef.current?.readyState === WebSocket.OPEN && e.data.size > 1000) {
            const reader = new FileReader()
            reader.onloadend = () => {
              const base64data = (reader.result as string).split(',')[1]
              socketRef.current?.send(JSON.stringify({ type: 'stt-chunk', audio: base64data }))
            }
            reader.readAsDataURL(e.data)
          }
        }

        recorder.start()
        setTimeout(() => { if (recorder.state === 'recording') recorder.stop() }, 4000)
        setTimeout(() => { if (isRecordingRef.current) startRecordingBurst() }, 2000)
      }

      isRecordingRef.current = true
      setIsRecording(true)
      startRecordingBurst()
    } catch {
      showToast('Microphone access denied or unavailable.')
    }
  }

  const stopTranscription = () => {
    isRecordingRef.current = false
    setIsRecording(false)
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop()
    }
    mediaRecorderRef.current = null
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(t => t.stop())
      mediaStreamRef.current = null
    }
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current)
      animFrameRef.current = 0
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close()
      audioCtxRef.current = null
    }
  }

  const fetchDocuments = async () => {
    try {
      const [docsResp, statsResp] = await Promise.all([
        fetch(`${API_BASE}/documents`),
        fetch(`${API_BASE}/storage-stats`)
      ])
      if (docsResp.ok) setDocuments(await docsResp.json())
      if (statsResp.ok) setStorageStats(await statsResp.json())
    } catch (err) {
      console.error('Failed to fetch vault stats:', err)
      showToast('Could not load resume vault. Is the backend running?')
    }
  }

  useEffect(() => {
    if (showResume) fetchDocuments()
  }, [showResume])

  const uploadFiles = async (files: FileList | File[]) => {
    const list = Array.from(files)
    if (!list.length) return

    const totalSize = list.reduce((sum, file) => sum + file.size, 0)
    let bytesTransferred = 0
    setResumeStatus(`Uploading ${list.length} file(s)...`)
    setUploadProgress(0)
    setUploadStage('Preparing upload...')
    setErrorBanner('')

    for (const file of list) {
      const fileStartBytes = bytesTransferred
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.open('POST', `${API_BASE}/upload-resume`)
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            const progress = Math.round(((fileStartBytes + event.loaded) / totalSize) * 100)
            setUploadProgress(progress)
            setUploadStage(`Uploading ${file.name}...`)
          }
        }
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            bytesTransferred += file.size
            resolve()
          } else {
            reject(new Error(xhr.statusText || 'Upload failed'))
          }
        }
        xhr.onerror = () => reject(new Error('Upload failed'))

        const form = new FormData()
        form.append('resume', file)
        xhr.send(form)
      }).catch((error) => {
        setResumeStatus(`Error: ${error.message || 'Upload failed'}`)
        showToast('Resume upload failed.')
        setUploadStage('Upload failed')
        setUploadProgress(0)
        setErrorBanner('Upload failed. Please retry.')
        throw error
      })
    }

    setResumeStatus('Upload complete!')
    setUploadStage('Complete')
    setUploadProgress(100)
    fetchDocuments()
    setTimeout(() => {
      setResumeStatus('')
      setUploadStage('')
      setUploadProgress(0)
    }, 1800)
  }

  const handleMultiFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return
    await uploadFiles(e.target.files)
    e.target.value = ''
  }

  const handleDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    setIsDragging(false)
    if (event.dataTransfer.files.length) {
      await uploadFiles(event.dataTransfer.files)
    }
  }

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    setIsDragging(true)
  }

  const handleDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const relatedTarget = event.relatedTarget as HTMLElement | null
    if (relatedTarget && event.currentTarget.contains(relatedTarget)) return
    setIsDragging(false)
  }

  const deleteDoc = async (id: string) => {
    try {
      const resp = await fetch(`${API_BASE}/documents/${id}`, { method: 'DELETE' })
      if (resp.ok) {
        if (selectedDocId === id) setSelectedDocId(null)
        fetchDocuments()
      } else {
        showToast('Could not delete document.')
      }
    } catch (err) {
      console.error('Delete failed:', err)
      showToast('Delete failed.')
    }
  }

  const retryUpload = () => {
    uploadInputRef.current?.click()
  }

  const takeSnapshot = async () => {
    const api = (window as any).electronAPI
    if (!api?.captureScreen) {
      showToast('Screen capture requires Electron.')
      return
    }
    setAssistantResponse('')
    setIsStreaming(true)
    try {
      const img = await api.captureScreen()
      socketRef.current?.send(JSON.stringify({ type: 'ask-vision', image: img }))
    } catch {
      setIsStreaming(false)
      showToast('Unable to capture screen.')
    }
  }

  const copyResponse = async () => {
    if (!assistantResponse) {
      showToast('No assistant response to copy.')
      return
    }
    try {
      await navigator.clipboard.writeText(assistantResponse)
      showToast('Answer copied to clipboard.')
    } catch {
      showToast('Copy failed.')
    }
  }

  const regenerateAnswer = () => {
    if (!lastQuestion) {
      showToast('No question to regenerate.')
      return
    }
    sendQuestion(lastQuestion)
  }

  const sendQuestion = useCallback((overrideQuestion?: string, clearInput = true) => {
    const prompt = overrideQuestion ?? question
    if (!prompt.trim()) {
      showToast('Type a question first.')
      return
    }
    if (!isConnected) {
      showToast('Backend is not connected.')
      return
    }
    if (isStreaming) {
      showToast('Wait for the current response or clear it.')
      return
    }

    setLastQuestion(prompt)
    setAssistantResponse('')
    setIsStreaming(true)
    currentRequestRef.current = { question: prompt, answer: '' }
    socketRef.current?.send(JSON.stringify({ type: 'ask-question', question: prompt }))
    if (clearInput) setQuestion('')
  }, [question, isConnected, isStreaming, showToast])

  useEffect(() => {
    sendQuestionRef.current = sendQuestion
  }, [sendQuestion])

  const handleStealthToggle = () => {
    const api = (window as any).electronAPI
    if (!api?.toggleCaptureProtection) {
      showToast('Stealth mode requires Electron.')
      return
    }
    api.toggleCaptureProtection(!stealthMode).then(() => setStealthMode(prev => !prev))
  }

  return (
    <>
      <div className="top-bar">
        <div className="status-group">
          <div className={`status-dot ${isConnected ? '' : 'offline'}`} />
          <span className="status-text">{isConnected ? 'Connected' : 'Offline'}</span>
          {uploadStage && <span className="status-text">| {uploadStage}</span>}
        </div>
        <div className="nav-group">
          <button
            className={`nav-btn ${isRecording ? 'active danger' : ''}`}
            title="Hold to record (Ctrl+M)"
            onPointerDown={(e) => { e.preventDefault(); if (!isRecording) startTranscription() }}
            onPointerUp={(e) => { e.preventDefault(); if (isRecording) stopTranscription() }}
          >
            {isRecording ? <div className="recording-dot" /> : <span className="icon">🎙</span>}
            <span>{isRecording ? 'Listening...' : 'Mic'}</span>
          </button>
          <button className="nav-btn" onClick={takeSnapshot} title="Snapshot screen">
            <span className="icon">📸</span> <span>Snapshot</span>
          </button>
          <button className={`nav-btn ${showResume ? 'active' : ''}`} onClick={() => setShowResume(!showResume)} title="Resume vault">
            <span className="icon">📄</span> <span>Vault</span>
          </button>
          <button className={`nav-btn ${stealthMode ? 'active' : ''}`} onClick={handleStealthToggle} title="Toggle stealth mode">
            <span className="icon">{stealthMode ? '🛡' : '👁'}</span> <span>Stealth</span>
          </button>
          <button className="nav-btn" onClick={() => setAssistantResponse('')} title="Clear response">
            <span className="icon">✨</span> <span>Clear</span>
          </button>
          <button className="nav-btn" onClick={() => setShowSettings(true)} title="Settings">
            <span className="icon">⚙</span>
          </button>
        </div>
      </div>

      <div className="content-area">
        <div className="welcome-card">
          <div className="welcome-title">Interview Assistant</div>
          <div className="welcome-text">Upload your resume, speak or type a question, and get a concise answer with coaching tips.</div>
        </div>

        {showHowTo && (
          <div className="tips-card">
            <div className="tips-header">Quick Start</div>
            <div className="tips-list">
              <div className="tip-item">
                <div className="tip-number">1</div>
                <span>Upload your resume or paste text into the vault</span>
              </div>
              <div className="tip-item">
                <div className="tip-number">2</div>
                <span>Press and hold the mic, or type a question below</span>
              </div>
              <div className="tip-item">
                <div className="tip-number">3</div>
                <span>Confirm any detected interview question</span>
              </div>
              <div className="tip-item">
                <div className="tip-number">4</div>
                <span>Copy the final answer and use it as prep notes</span>
              </div>
            </div>
            <button className="tips-dismiss" onClick={() => setShowHowTo(false)}>Got it</button>
          </div>
        )}

        {detectedQuestion && (
          <div className="detected-card">
            <div className="detected-label">Detected Question</div>
            <div className="detected-text">{detectedQuestion}</div>
            <div className="detected-actions">
              <button className="nav-btn active" onClick={() => sendQuestion(detectedQuestion)}>Send</button>
              <button className="nav-btn" onClick={() => setDetectedQuestion(null)}>Dismiss</button>
            </div>
          </div>
        )}

        {(assistantResponse || isStreaming) && (
          <div className="response-panel">
            <div className="response-header">
              <span className="response-label">AI Response</span>
              <div className="response-actions">
                <button className="nav-btn" onClick={copyResponse} title="Copy">📋 Copy</button>
                <button className="nav-btn" onClick={regenerateAnswer} title="Regenerate">🔄 Regenerate</button>
                <button className="close-btn" onClick={() => setAssistantResponse('')}>×</button>
              </div>
            </div>
            <div className="response-body" ref={panelContentRef}>
              <MarkdownRenderer content={assistantResponse || 'Your answer will appear here...'} />
              {isStreaming && (
                <div className="typing-indicator">
                  <div className="typing-dots">
                    <span></span><span></span><span></span>
                  </div>
                  Streaming answer...
                </div>
              )}
            </div>
            {history.length > 0 && (
              <div className="history-section">
                <div className="history-title">Recent Answers</div>
                {history.slice(0, 3).map((item, index) => (
                  <div key={index} className="history-item" onClick={() => { setQuestion(item.question); setAssistantResponse(item.answer) }}>
                    <div className="history-question">{item.question}</div>
                    <div className="history-time">{item.timestamp}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="input-area">
        <div className="input-wrapper">
          <div className="quick-actions">
            <button className="quick-btn" onClick={() => sendQuestion('Ask me an interview question.', false)}>Ask Interview Question</button>
            <button className="quick-btn" onClick={() => setQuestion(lastTranscript || '')}>Use Last Transcript</button>
            <button className="quick-btn" onClick={() => takeSnapshot()}>Snapshot + Ask</button>
            <button className="quick-btn" onClick={() => setQuestion('Paste my resume text here and ask about my experience.')}>Paste Resume Prompt</button>
          </div>
          <div className="input-row">
            <div className="textarea-wrapper">
              <textarea
                ref={inputRef}
                className="question-input"
                placeholder={isStreaming ? 'Generating answer...' : 'Type your question here...'}
                value={question}
                onChange={e => setQuestion(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), sendQuestion())}
                rows={2}
                disabled={isStreaming}
              />
            </div>
            <button className="send-btn" onClick={() => sendQuestion()} disabled={isStreaming}>
              {isStreaming ? '...' : 'Send'}
            </button>
          </div>
        </div>
      </div>

      {showResume && (
        <div className="overlay-backdrop" onClick={() => setShowResume(false)}>
          <div className="overlay-panel" onClick={e => e.stopPropagation()}>
            <div className="overlay-header">
              <span className="overlay-title">Knowledge Vault</span>
              <button className="close-btn" onClick={() => setShowResume(false)}>×</button>
            </div>

            <div className="storage-bar">
              <div className="storage-header">
                <span>Storage</span>
                <span>{(storageStats.used / 1024 / 1024).toFixed(2)} MB / 10 MB</span>
              </div>
              <div className="storage-track">
                <div className="storage-fill" style={{ width: `${storageStats.percent}%` }} />
              </div>
            </div>

            <div
              className={`upload-zone ${isDragging ? 'dragging' : ''}`}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={() => uploadInputRef.current?.click()}
            >
              <div className="upload-icon">📁</div>
              <div className="upload-text">
                <strong>Click to upload</strong> or drag and drop
                <br />PDF, TXT files supported
              </div>
              <input ref={uploadInputRef} type="file" multiple accept=".pdf,.txt" style={{ display: 'none' }} onChange={handleMultiFileUpload} />
            </div>

            {documents.length > 0 ? (
              <div className="doc-list">
                {documents.map(doc => (
                  <div key={doc.id} className={`doc-item ${doc.id === selectedDocId ? 'selected' : ''}`} onClick={() => setSelectedDocId(doc.id)}>
                    <div className="doc-info">
                      <div className="doc-name">{doc.name}</div>
                      <div className="doc-size">{(doc.size / 1024).toFixed(1)} KB</div>
                    </div>
                    <button className="doc-delete" onClick={(e) => { e.stopPropagation(); deleteDoc(doc.id) }}>×</button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state">No documents uploaded yet</div>
            )}

            <div className="ingest-section">
              <div className="ingest-label">Quick Paste</div>
              <textarea
                className="ingest-textarea"
                placeholder="Paste text context here..."
                value={resumeText}
                onChange={e => setResumeText(e.target.value)}
              />
              <button className="ingest-btn" onClick={() => {
                if (!resumeText.trim()) {
                  showToast('Paste text to ingest.')
                  return
                }
                fetch(`${API_BASE}/ingest-resume`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: resumeText, name: 'Pasted_Text_' + Date.now() + '.txt' }) })
                  .then(() => { setResumeText(''); fetchDocuments(); setResumeStatus('Ingested') })
                  .catch(() => { showToast('Text ingest failed.') })
              }}>Ingest Text</button>
            </div>

            {resumeStatus && <div className="setting-note">{resumeStatus}</div>}
            {errorBanner && <div className="setting-note" style={{ color: 'var(--red)' }}>{errorBanner} <button className="nav-btn" onClick={retryUpload}>Retry</button></div>}
          </div>
        </div>
      )}

      {showSettings && (
        <div className="overlay-backdrop" onClick={() => setShowSettings(false)}>
          <div className="overlay-panel" onClick={e => e.stopPropagation()}>
            <div className="overlay-header">
              <span className="overlay-title">Settings</span>
              <button className="close-btn" onClick={() => setShowSettings(false)}>×</button>
            </div>
            <div className="setting-row">
              <span className="setting-label">Backend</span>
              <span className="setting-value">{WS_URL}</span>
            </div>
            <div className="setting-row">
              <span className="setting-label">Stealth Mode</span>
              <span className="setting-value">{stealthMode ? 'Enabled' : 'Disabled'}</span>
            </div>
            <div className="setting-row">
              <span className="setting-label">Resume Vault</span>
              <span className="setting-value">{documents.length} documents</span>
            </div>
            <div className="setting-note">
              For API provider configuration, update your backend `.env` file and restart the app.
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </>
  )
}
