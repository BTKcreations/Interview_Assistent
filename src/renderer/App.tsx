import React, { useState, useEffect, useRef, useCallback } from 'react'
import './styles.css'

interface Message {
  text: string
  type: 'user' | 'assistant' | 'transcript' | 'error'
}

const MarkdownRenderer = ({ content }: { content: string }) => {
  const lines = content.split('\n')
  const renderedLines: React.ReactNode[] = []
  let inCodeBlock = false
  let codeBuffer: string[] = []

  lines.forEach((line, i) => {
    if (line.trim().startsWith('```')) {
      if (inCodeBlock) {
        renderedLines.push(<pre key={`code-${i}`}><code>{codeBuffer.join('\n')}</code></pre>)
        codeBuffer = []; inCodeBlock = false
      } else inCodeBlock = true
      return
    }
    if (inCodeBlock) { codeBuffer.push(line); return }
    if (line.startsWith('### ')) renderedLines.push(<h2 key={i}>{line.slice(4)}</h2>)
    else if (line.startsWith('# ')) renderedLines.push(<h1 key={i}>{line.slice(2)}</h1>)
    else if (line.trim().startsWith('* ') || line.trim().startsWith('- ')) renderedLines.push(<li key={i}>{line.trim().slice(2)}</li>)
    else if (line.trim() === '') renderedLines.push(<br key={i} />)
    else {
      const parts = line.split(/(\*\*.*?\*\*|`.*?`)/)
      const formatted = parts.map((part, pi) => {
        if (part.startsWith('**') && part.endsWith('**')) return <strong key={pi}>{part.slice(2, -2)}</strong>
        if (part.startsWith('`') && part.endsWith('`')) return <code key={pi}>{part.slice(1, -1)}</code>
        return part
      })
      renderedLines.push(<p key={i}>{formatted}</p>)
    }
  })
  if (inCodeBlock) renderedLines.push(<pre key="code-last"><code>{codeBuffer.join('\n')}</code></pre>)
  return <div className="markdown">{renderedLines}</div>
}

export default function App() {
  const [messages, setMessages] = useState<Message[]>([])
  const [question, setQuestion] = useState('')
  const [isRecording, setIsRecording] = useState(false)
  const [transcriptStatus, setTranscriptStatus] = useState('Mic inactive')
  const [resumeText, setResumeText] = useState('')
  const [resumeStatus, setResumeStatus] = useState('')
  const [showResume, setShowResume] = useState(false)
  const [isStreaming, setIsStreaming] = useState(false)
  const [assistantResponse, setAssistantResponse] = useState('')
  const [stealthMode, setStealthMode] = useState(true)
  const [audioLevel, setAudioLevel] = useState(0)

  const [documents, setDocuments] = useState<any[]>([])
  const [storageStats, setStorageStats] = useState({ used: 0, limit: 10 * 1024 * 1024, percent: 0, count: 0 })

  const audioLevelRef = useRef(0)
  const socketRef = useRef<WebSocket | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const isRecordingRef = useRef(false)
  const recognitionRef = useRef<any>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const api = (window as any).electronAPI
    if (api) {
      const offMic = api.onShortcutToggleMic(() => {
        const btn = document.querySelector('.nav-btn') as HTMLButtonElement
        if (btn) btn.click()
      })
      const offSnapshot = api.onShortcutSnapshot(() => {
        takeSnapshot()
      })
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
  }, []) // Bind once on mount

  const connectionUrl = 'ws://localhost:8080'

  useEffect(() => {
    const socket = new WebSocket(connectionUrl)
    socketRef.current = socket
    socket.onopen = () => socket.send(JSON.stringify({ type: 'client-ready' }))
    socket.onmessage = (event) => {
      const payload = JSON.parse(event.data)
      if (payload.type === 'assistant-start') { setIsStreaming(true); setAssistantResponse('') }
      else if (payload.type === 'assistant-chunk') setAssistantResponse(prev => prev + (payload.text ?? ''))
      else if (payload.type === 'assistant-end') setIsStreaming(false)
      else if (payload.type === 'stt-result') {
        const text = payload.text.trim()
        if (text && text.length > 1) {
          setQuestion(prev => {
            const prevWords = prev.trim().split(' ')
            const nextWords = text.split(' ')
            
            // Look for overlap (last 3 words)
            let overlapIndex = -1
            for (let i = Math.max(0, prevWords.length - 5); i < prevWords.length; i++) {
              if (nextWords[0]?.toLowerCase() === prevWords[i]?.toLowerCase()) {
                // Check if subsequent words also match
                let match = true
                for (let j = 0; j < Math.min(nextWords.length, prevWords.length - i); j++) {
                  if (nextWords[j]?.toLowerCase() !== prevWords[i + j]?.toLowerCase()) {
                    match = false; break
                  }
                }
                if (match) { overlapIndex = i; break }
              }
            }

            if (overlapIndex !== -1) {
              const uniqueNext = nextWords.slice(prevWords.length - overlapIndex).join(' ')
              return (prev + ' ' + uniqueNext).trim()
            }
            return (prev.trim() ? prev + ' ' : '') + text
          })
          setTranscriptStatus('🎙️ Listening (Lightning)...')
        }
      }
    }
    return () => socket.close()
  }, [connectionUrl])

  const startTranscription = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      mediaStreamRef.current = stream

      // Visualizer logic (Cool UI)
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
        let sum = 0
        for (let i = 0; i < dataArray.length; i++) sum += dataArray[i]
        const level = Math.min(100, Math.floor((sum / dataArray.length) * 1.5))
        setAudioLevel(level)
        audioLevelRef.current = level
        requestAnimationFrame(updateLevel)
      }
      updateLevel()

      // DUAL OVERLAP LOGIC: Capture every word twice to prevent cutting
      const startRecordingBurst = () => {
        if (!mediaStreamRef.current || !isRecordingRef.current) return
        
        const recorder = new MediaRecorder(mediaStreamRef.current, { mimeType: 'audio/webm' })
        let burstHasAudio = false

        // Use the global audio level from the visualizer
        const checkGlobalAudio = () => {
          if (recorder.state !== 'recording') return
          // audioLevel is updated by the main visualizer loop
          // Using a small threshold to catch any real sound
          if (audioLevelRef.current > 1) burstHasAudio = true
          requestAnimationFrame(checkGlobalAudio)
        }
        checkGlobalAudio()
        
        recorder.ondataavailable = async (e) => {
          if (socketRef.current?.readyState === WebSocket.OPEN) {
            socketRef.current.send(JSON.stringify({ 
              type: 'debug', 
              message: `🏁 Burst Complete. Size: ${e.data.size} bytes, Level: ${audioLevelRef.current}` 
            }))
          }

          // Force everything through - the backend hallucination filter will handle silence
          if (e.data.size > 1000 && socketRef.current?.readyState === WebSocket.OPEN) {
            const reader = new FileReader()
            reader.onloadend = () => {
              const base64data = (reader.result as string).split(',')[1]
              socketRef.current?.send(JSON.stringify({ type: 'stt-chunk', audio: base64data }))
            }
            reader.readAsDataURL(e.data)
          }
        }

        recorder.start()
        if (socketRef.current?.readyState === WebSocket.OPEN) {
          socketRef.current.send(JSON.stringify({ type: 'debug', message: '🎙️ Burst Started...' }))
        }
        setTimeout(() => { if (recorder.state === 'recording') recorder.stop() }, 4000)
        setTimeout(() => { if (isRecordingRef.current) startRecordingBurst() }, 2000)
      }

      isRecordingRef.current = true
      setIsRecording(true)
      setTranscriptStatus('🎙️ Listening (Lightning)...')
      startRecordingBurst()
    } catch (err) {
      setTranscriptStatus('❌ Mic Access Denied')
    }
  }

  const stopTranscription = () => {
    isRecordingRef.current = false
    setIsRecording(false)
    if (mediaRecorderRef.current) mediaRecorderRef.current.stop()
    if (mediaStreamRef.current) mediaStreamRef.current.getTracks().forEach(t => t.stop())
    if (audioCtxRef.current) audioCtxRef.current.close()
    setTranscriptStatus('Mic inactive')
  }

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'stt-result') {
        setQuestion(event.data.text)
      } else if (event.data?.type === 'stt-error') {
        setTranscriptStatus(`❌ Error: ${event.data.error}`)
        setIsRecording(false)
      }
    };
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [])

  const fetchDocuments = async () => {
    try {
      const [docsResp, statsResp] = await Promise.all([
        fetch('http://localhost:8080/documents'),
        fetch('http://localhost:8080/storage-stats')
      ])
      if (docsResp.ok) setDocuments(await docsResp.json())
      if (statsResp.ok) setStorageStats(await statsResp.json())
    } catch (err) {
      console.error('Failed to fetch vault stats:', err)
    }
  }

  useEffect(() => {
    if (showResume) fetchDocuments()
  }, [showResume])

  const handleMultiFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return
    
    setResumeStatus(`⏳ Uploading ${files.length} file(s)...`)
    
    for (const file of Array.from(files)) {
      const formData = new FormData()
      formData.append('resume', file)

      try {
        const resp = await fetch('http://localhost:8080/upload-resume', {
          method: 'POST',
          body: formData
        })
        if (!resp.ok) {
          const err = await resp.json()
          setResumeStatus(`❌ Error: ${err.message || 'Upload failed'}`)
          break
        }
      } catch {
        setResumeStatus('❌ Server error during upload')
        break
      }
    }
    
    setResumeStatus('✅ Upload complete!')
    fetchDocuments()
    setTimeout(() => setResumeStatus(''), 2000)
  }

  const deleteDoc = async (id: string) => {
    try {
      const resp = await fetch(`http://localhost:8080/documents/${id}`, { method: 'DELETE' })
      if (resp.ok) fetchDocuments()
    } catch (err) {
      console.error('Delete failed:', err)
    }
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    handleMultiFileUpload(e)
  }

  const takeSnapshot = async () => {
    setAssistantResponse(''); setIsStreaming(true)
    try {
      const img = await (window as any).electronAPI.captureScreen()
      socketRef.current?.send(JSON.stringify({ type: 'ask-vision', image: img }))
    } catch { setIsStreaming(false) }
  }

  const sendQuestion = () => {
    if (!question.trim()) return
    setAssistantResponse(''); setIsStreaming(true)
    socketRef.current?.send(JSON.stringify({ type: 'ask-question', question }))
    setQuestion('')
  }

  return (
    <div id="root">
      <iframe id="speech-helper" src="/speech_helper.html" style={{ display: 'none' }} />
      <div className="top-bar">
        <div className="nav-group">
          <button className={`nav-btn ${isRecording ? 'active danger' : ''}`} onClick={isRecording ? stopTranscription : startTranscription}>
            {isRecording ? <div className="recording-dot" /> : '🎤'}
            <span>{isRecording ? 'Listening' : 'Mic'}</span>
            <span style={{ fontSize: '10px', opacity: 0.7, marginLeft: 4 }}>{transcriptStatus}</span>
            {isRecording && (
              <div className="audio-visualizer">
                {[1, 2, 3, 4].map(i => (
                  <div key={i} className="v-bar" style={{ height: `${2 + (audioLevel * (0.3 + Math.random() * 0.7))}px` }} />
                ))}
              </div>
            )}
          </button>
          <button className="nav-btn" onClick={takeSnapshot}>📸 <span>Snapshot</span></button>
          <div className="nav-divider" />
          <button className={`nav-btn ${showResume ? 'active' : ''}`} onClick={() => setShowResume(!showResume)}>📄 <span>Resume</span></button>
          <button className={`nav-btn ${stealthMode ? 'active' : ''}`} onClick={() => (window as any).electronAPI.toggleCaptureProtection(!stealthMode).then(() => setStealthMode(!stealthMode))}>
            {stealthMode ? '🛡️' : '👁️'} <span>Stealth</span>
          </button>
          <div className="nav-divider" />
          <button className="nav-btn" onClick={() => setAssistantResponse('')}>🧹 <span>Clear</span></button>
        </div>
      </div>

      {showResume && (
        <div className="overlay-card" style={{ width: '380px', maxHeight: '500px', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <h3 style={{ margin: 0, fontSize: '18px', display: 'flex', alignItems: 'center', gap: '8px' }}>🏢 Knowledge Vault</h3>
            <button className="nav-btn" onClick={() => setShowResume(false)} style={{ padding: '4px 8px' }}>✕</button>
          </div>

          {/* STORAGE STATS */}
          <div style={{ marginBottom: '20px', background: 'rgba(255,255,255,0.05)', padding: '12px', borderRadius: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '6px', opacity: 0.8 }}>
              <span>Storage Usage</span>
              <span>{(storageStats.used / 1024 / 1024).toFixed(2)} MB / 10 MB</span>
            </div>
            <div style={{ height: '6px', background: 'rgba(255,255,255,0.1)', borderRadius: '10px', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${storageStats.percent}%`, background: 'var(--accent)', transition: 'width 0.5s ease' }} />
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', flex: 1, overflow: 'hidden' }}>
            {/* UPLOAD ACTION */}
            <label className="nav-btn active" style={{ cursor: 'pointer', textAlign: 'center', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '12px' }}>
              📁 <span>Upload Documents</span>
              <input type="file" multiple accept=".pdf,.txt" style={{ display: 'none' }} onChange={handleMultiFileUpload} />
            </label>

            {/* DOCUMENT LIST */}
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px', paddingRight: '4px' }}>
              {documents.length === 0 ? (
                <div style={{ textAlign: 'center', opacity: 0.4, padding: '20px', fontSize: '14px' }}>Vault is empty.<br/>Upload resumes or company info.</div>
              ) : (
                documents.map(doc => (
                  <div key={doc.id} style={{ background: 'rgba(255,255,255,0.05)', padding: '10px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ overflow: 'hidden' }}>
                      <div style={{ fontSize: '13px', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>{doc.name}</div>
                      <div style={{ fontSize: '10px', opacity: 0.5 }}>{(doc.size / 1024).toFixed(1)} KB</div>
                    </div>
                    <button onClick={() => deleteDoc(doc.id)} style={{ background: 'none', border: 'none', color: '#ff4444', cursor: 'pointer', fontSize: '16px', padding: '4px' }}>✕</button>
                  </div>
                ))
              )}
            </div>

            <div style={{ textAlign: 'center', opacity: 0.5, fontSize: '11px', margin: '4px 0' }}>— QUICK PASTE —</div>
            <textarea className="resume-textarea" placeholder="Paste text context here..." value={resumeText} onChange={e => setResumeText(e.target.value)} style={{ height: '60px', minHeight: '60px' }} />
            <button className="nav-btn" style={{ width: '100%' }} onClick={() => fetch('http://localhost:8080/ingest-resume', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: resumeText, name: 'Pasted_Text_' + Date.now() + '.txt' }) }).then(() => { setResumeText(''); fetchDocuments(); setResumeStatus('✓ Ingested') })}>Ingest Text</button>
          </div>
          {resumeStatus && <div className="resume-meta" style={{ marginTop: 12, textAlign: 'center', color: 'var(--accent)', fontSize: '13px', fontWeight: 'bold' }}>{resumeStatus}</div>}
        </div>
      )}

      {(assistantResponse || isStreaming) && (
        <div className="response-panel">
          <div className="panel-header">
            <span className="panel-title">AI Assistant</span>
            <button className="close-btn" onClick={() => setAssistantResponse('')}>×</button>
          </div>
          <div className="panel-content">
            <MarkdownRenderer content={assistantResponse} />
            {isStreaming && <span className="cursor" />}
          </div>
        </div>
      )}

      <div className="input-section">
        <textarea 
          ref={inputRef}
          className="question-input" 
          placeholder="Voice transcript or type here..." 
          value={question} 
          onChange={e => setQuestion(e.target.value)} 
          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), sendQuestion())} 
          rows={1} 
          style={{ background: 'var(--bg-glass)', backdropFilter: 'blur(30px)', borderRadius: '20px', border: '1px solid var(--bg-glass-bright)', padding: '12px 20px', color: 'white', flex: 1, outline: 'none' }} 
        />
      </div>
    </div>
  )
}
