/// <reference types="vite/client" />

interface Window {
  electronAPI: {
    healthCheck: () => Promise<{ status: string }>
  }
}
