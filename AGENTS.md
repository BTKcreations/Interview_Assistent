# AGENTS.md - Free AI Providers Guide

> **RULE #1: NEVER use paid APIs.** Every AI feature in this project MUST use free-tier providers.
> Before writing ANY code that calls an AI API, read this file and pick the right free provider.

---

## Quick Reference: Free Provider Priority

| Use Case | Priority 1 (Best) | Priority 2 (Fallback) | Priority 3 (Last Resort) |
|---|---|---|---|
| **Chat / LLM** | Groq (fastest) | Google Gemini (smartest) | Ollama (local, unlimited) |
| **STT (Speech-to-Text)** | Groq Whisper | Deepgram (free credits) | Whisper.js (browser-local) |
| **Embeddings** | Local (TF-IDF) | HuggingFace (free tier) | Ollama (local) |
| **Vision / Multimodal** | Google Gemini (free) | Ollama + LLaVA (local) | - |
| **TTS (Text-to-Speech)** | Browser SpeechSynthesis | ElevenLabs (free tier) | - |

---

## Free LLM Providers (Chat Completions)

### Tier S - Best Free Options

#### 1. Groq (FASTEST - Recommended Primary)
- **URL:** https://console.groq.com
- **Credit Card:** NOT required
- **Free Limits:** 30 RPM, 1,000 RPD, 6K TPM, 100K TPD
- **Models:** Llama 3.3 70B, Llama 3.1 8B, Mixtral 8x7B, Gemma 2 9B
- **Speed:** 500-700+ tokens/sec (fastest in the world)
- **API Format:** OpenAI-compatible (`/v1/chat/completions`)
- **Endpoint:** `https://api.groq.com/openai/v1`
- **.env Setup:**
  ```
  GROQ_API_KEY=gsk_xxxxx
  GROQ_API_URL=https://api.groq.com/openai/v1
  GROQ_CHAT_MODEL=llama-3.3-70b-versatile
  ```

#### 2. Google AI Studio (SMARTEST Free Option)
- **URL:** https://aistudio.google.com
- **Credit Card:** NOT required (Google account only)
- **Free Limits:** 1,500 RPD, 10 RPM (Gemini 2.5 Flash)
- **Models:** Gemini 2.5 Flash, Gemini 2.0 Flash
- **Context Window:** 1 million tokens
- **Multimodal:** Images, PDFs, audio, video (all free)
- **API Format:** Google AI SDK (NOT OpenAI-compatible by default)
- **API Key:** `https://aistudio.google.com/apikey`
- **.env Setup:**
  ```
  GOOGLE_AI_API_KEY=AIzaSyxxxxx
  GOOGLE_AI_MODEL=gemini-2.5-flash
  ```
- **Note:** Free-tier data may be used for model improvement. Do NOT use for sensitive data.

#### 3. OpenRouter (MOST Models)
- **URL:** https://openrouter.ai
- **Credit Card:** NOT required
- **Free Limits:** 20 RPM, 50 RPD (without credits); 1,000 RPD (with $10+ credits)
- **Free Models:** Llama 3.2 3B, Mistral 7B, Phi-3 Mini, Qwen 2 7B (use `:free` suffix)
- **API Format:** OpenAI-compatible
- **Endpoint:** `https://openrouter.ai/api/v1`
- **.env Setup:**
  ```
  OPENROUTER_API_KEY=sk-or-v1-xxxxx
  OPENROUTER_CHAT_MODEL=meta-llama/llama-3.1-8b-instruct:free
  ```

### Tier A - Good Free Options

#### 4. NVIDIA NIM
- **URL:** https://build.nvidia.com
- **Credit Card:** NOT required (phone verification needed)
- **Free Limits:** 40 RPM, no daily cap
- **Models:** 100+ open models (Llama, Mistral, Gemma, DeepSeek, etc.)
- **API Format:** OpenAI-compatible
- **Endpoint:** `https://integrate.api.nvidia.com/v1`

#### 5. Cerebras
- **URL:** https://cloud.cerebras.ai
- **Credit Card:** NOT required
- **Free Limits:** 5 RPM, 30K TPM, 1M tokens/day
- **Models:** Llama 3.1 8B, Llama 3.1 70B
- **Speed:** 2,000+ tokens/sec
- **API Format:** OpenAI-compatible

#### 6. Cloudflare Workers AI
- **URL:** https://developers.cloudflare.com/workers-ai
- **Credit Card:** NOT required
- **Free Limits:** 10,000 neurons/day, 300 RPM total
- **Models:** Llama, Mistral, Phi, Qwen variants
- **Edge deployment** (runs on Cloudflare network)

### Tier B - Local (Unlimited, No API Key)

#### 7. Ollama (UNLIMITED - No API Key Needed)
- **URL:** https://ollama.com
- **Cost:** Free forever (runs on your machine)
- **Limits:** Unlimited (limited only by your hardware)
- **Models:** Llama 3.3, Gemma 2, Mistral, Phi-3, Qwen 2, DeepSeek, etc.
- **Requirements:** 8GB+ RAM recommended, GPU optional
- **API Format:** OpenAI-compatible at `http://localhost:11434/v1`
- **.env Setup:**
  ```
  USE_OLLAMA=true
  OLLAMA_API_URL=http://127.0.0.1:11434
  OLLAMA_MODEL=llama3.1:8b
  ```
- **Setup:**
  ```bash
  # Install Ollama
  winget install Ollama.Ollama
  # Pull a model
  ollama pull llama3.1:8b
  # Start server (auto-starts on install)
  ollama serve
  ```

---

## Free STT Providers (Speech-to-Text)

### Tier S - Best Free Options

#### 1. Groq Whisper (FASTEST)
- **Model:** whisper-large-v3, whisper-large-v3-turbo
- **Free Limits:** Same as Groq LLM (30 RPM, 1,000 RPD)
- **Endpoint:** `https://api.groq.com/openai/v1/audio/transcriptions`
- **Same API key** as Groq LLM
- **Best for:** Real-time transcription, interview apps
- **Languages:** 100+

#### 2. Deepgram (Free $200 Credits)
- **URL:** https://console.deepgram.com/signup
- **Free Limits:** $200 in free credits (no credit card for signup)
- **Models:** Nova-2, Nova-3 (lowest WER in benchmarks)
- **Endpoint:** `https://api.deepgram.com/v1/listen`
- **Streaming:** Yes, sub-250ms latency
- **Best for:** Production-grade accuracy

### Tier B - Local (Unlimited)

#### 3. Whisper.js (Browser-Local)
- **Cost:** Free (runs in browser via WebAssembly)
- **Limits:** Unlimited
- **Accuracy:** Lower than cloud APIs
- **Latency:** Slower (depends on device)
- **Best for:** Offline/privacy-focused apps

---

## Free Embedding Providers

### Tier S - Best Free Options

#### 1. Local TF-IDF (NO API KEY - Recommended Default)
- **Cost:** Free forever
- **Limits:** Unlimited
- **Quality:** Good enough for most RAG/search use cases
- **Latency:** Instant (no network call)
- **Use when:** Building prototypes, document search, resume matching
- **.env Setup:**
  ```
  EMBEDDING_PROVIDER=local
  ```

#### 2. HuggingFace Inference API (FREE TIER)
- **URL:** https://huggingface.co
- **Credit Card:** NOT required
- **Free Limits:** Rate-limited (varies by model)
- **Models:** sentence-transformers/all-MiniLM-L6-v2, all-mpnet-base-v2
- **API Format:** REST API
- **.env Setup:**
  ```
  EMBEDDING_PROVIDER=huggingface
  HUGGINGFACE_API_KEY=hf_xxxxx
  HUGGINGFACE_EMBEDDING_MODEL=sentence-transformers/all-MiniLM-L6-v2
  ```

### Tier B - Local (Unlimited)

#### 3. Ollama Embeddings
- **Model:** nomic-embed-text, mxbai-embed-large
- **Cost:** Free (runs locally)
- **.env Setup:**
  ```
  EMBEDDING_PROVIDER=ollama
  USE_OLLAMA=true
  OLLAMA_EMBEDDING_MODEL=nomic-embed-text
  ```

---

## Free Vision / Multimodal Providers

#### 1. Google Gemini (BEST Free Vision)
- **Models:** Gemini 2.5 Flash (multimodal)
- **Supports:** Images, PDFs, audio, video
- **Context:** 1M tokens
- **Free:** Yes (1,500 RPD)

#### 2. Ollama + LLaVA (LOCAL Free Vision)
- **Model:** llava, llava-llama3, bakllava
- **Cost:** Free (runs locally)
- **Setup:**
  ```bash
  ollama pull llava
  ```

---

## Free TTS Providers (Text-to-Speech)

#### 1. Browser SpeechSynthesis (Built-in)
- **Cost:** Free (built into every browser)
- **Limits:** Unlimited
- **Languages:** Varies by OS/browser
- **Quality:** Robotic but functional
- **Usage:**
  ```javascript
  const utterance = new SpeechSynthesisUtterance("Hello world")
  speechSynthesis.speak(utterance)
  ```

---

## .env Template (All Free Providers)

```bash
# ============================================
# FREE AI PROVIDERS - NO PAID API KEYS
# ============================================

# --- LLM Chat (Pick ONE primary, others as fallback) ---
# Option A: Groq (Fastest - Recommended)
GROQ_API_KEY=gsk_xxxxx
GROQ_CHAT_MODEL=llama-3.3-70b-versatile

# Option B: Google Gemini (Smartest)
# GOOGLE_AI_API_KEY=AIzaSyxxxxx
# GOOGLE_AI_MODEL=gemini-2.5-flash

# Option C: OpenRouter (Most Models)
# OPENROUTER_API_KEY=sk-or-v1-xxxxx
# OPENROUTER_CHAT_MODEL=meta-llama/llama-3.1-8b-instruct:free

# Option D: Ollama (Local - Unlimited)
USE_OLLAMA=true
OLLAMA_API_URL=http://127.0.0.1:11434
OLLAMA_MODEL=llama3.1:8b

# --- STT (Speech-to-Text) ---
# Option A: Groq Whisper (Fastest - use same key as above)
GROQ_STT_MODEL=whisper-large-v3-turbo

# Option B: Deepgram ($200 free credits)
DEEPGRAM_API_KEY=xxxxx
DEEPGRAM_MODEL=nova-2

# --- Embeddings ---
# Option A: Local TF-IDF (Recommended - No API needed)
EMBEDDING_PROVIDER=local

# Option B: HuggingFace (Free tier)
# EMBEDDING_PROVIDER=huggingface
# HUGGINGFACE_API_KEY=hf_xxxxx
# HUGGINGFACE_EMBEDDING_MODEL=sentence-transformers/all-MiniLM-L6-v2

# --- Vision (for screen analysis) ---
# Uses Google Gemini or Ollama LLaVA (see above)

# --- TTS ---
# Uses browser SpeechSynthesis (no config needed)

# --- Backend ---
BACKEND_PORT=8080
```

---

## Provider Selection Rules

### When Building New Features
1. **Always try Groq first** for chat and STT (fastest, generous free tier)
2. **Use Local TF-IDF for embeddings** unless you need semantic search quality
3. **Use Ollama for local/offline** features or when rate limits are hit
4. **Use Google Gemini** only for multimodal (images/PDFs) or when you need top intelligence
5. **NEVER hardcode OpenAI keys** - always use environment variables with fallbacks

### Fallback Chain Pattern
Every AI call should follow this pattern:
```
1. Try Groq (fastest)
2. Fallback to Google Gemini (if Groq fails/rate limited)
3. Fallback to Ollama (if cloud fails)
4. Fallback to local/mock (if all fail)
```

### Rate Limit Handling
- Implement exponential backoff (1s, 2s, 4s, 8s)
- Cache responses when possible
- Rotate between providers if building high-traffic apps
- Log rate limit errors to adjust usage

### Data Privacy
- **Groq:** Does NOT train on your data
- **Google Gemini free tier:** May use data for model improvement
- **Ollama:** 100% local, no data leaves your machine
- **Deepgram:** SOC 2 compliant, data not used for training
- **HuggingFace:** Free tier may use data for improvement

---

## Getting Free API Keys

| Provider | Sign Up URL | Card Required | Time to Get Key |
|---|---|---|---|
| Groq | https://console.groq.com | No | 2 minutes |
| Google AI Studio | https://aistudio.google.com | No | 2 minutes |
| OpenRouter | https://openrouter.ai | No | 2 minutes |
| NVIDIA NIM | https://build.nvidia.com | No (phone) | 5 minutes |
| Cerebras | https://cloud.cerebras.ai | No | 3 minutes |
| Deepgram | https://console.deepgram.com | No | 3 minutes |
| HuggingFace | https://huggingface.co | No | 2 minutes |
| Ollama | https://ollama.com | No | 5 minutes (install) |

---

## Common Mistakes to Avoid

1. **Using OpenAI API when free alternatives exist** - Always check this file first
2. **Not implementing fallbacks** - Free tiers have rate limits, always have a backup
3. **Hardcoding API keys** - Always use `.env` with `process.env.VARIABLE`
4. **Ignoring local options** - Ollama and local embeddings are free forever
5. **Not caching** - Cache frequent requests to reduce API calls
6. **Using paid models for simple tasks** - A free 8B model can handle most chat tasks

---

## Verification Checklist

Before shipping any AI feature, verify:
- [ ] Primary provider is a FREE tier provider
- [ ] Fallback chain is implemented (at least 2 providers)
- [ ] Rate limit errors are handled gracefully
- [ ] API keys are in `.env`, not hardcoded
- [ ] No OpenAI API calls unless ALL free alternatives have been exhausted
- [ ] Response caching is implemented where possible
- [ ] Local fallback exists for offline use
