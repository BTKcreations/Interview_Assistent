# Interview Assistant

A starter Electron + React + Node.js project for a real-time AI interview assistant.

## Running the project

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy `.env.example` to `.env` and populate your API keys:
   ```bash
   cp .env.example .env
   ```
3. Start the development environment:
   ```bash
   npm run dev
   ```

## What is included

- Electron desktop shell with a transparent always-on-top overlay window
- React renderer powered by Vite
- Node.js backend with WebSocket support for live messaging
- Resume ingestion with real OpenAI embeddings and local retrieval
- Live file-based resume upload for PDF and text resumes
- Streaming STT integration via Deepgram and live mic transcription support
- Real-time prompt orchestration with OpenAI chat streaming

## Next steps

- Add OS-level audio capture pipelines for WASAPI / loopback
- Add system audio routing and local audio interception for desktop interviews
- Upgrade the STT flow to handle higher-quality stream encodings
- Attach a full cloud vector DB if you need persistence beyond memory
- Expand the assistant prompt logic to support more interview domains
