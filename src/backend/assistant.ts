import { ingestResumeText as storeResumeText, retrieveResumeContext as fetchResumeContext, hasResumeContext } from './vectorStore'
import { hasOpenAIKey, useOllama, streamChatCompletion, streamVisionCompletion } from './openaiClient'

export async function ingestResumeText(text: string, name?: string, size?: number) {
  return storeResumeText(text, name, size)
}

export async function retrieveResumeContext(question: string) {
  if (!hasResumeContext()) {
    return 'No resume context is available yet. Upload a resume to enable personalized responses.'
  }

  return fetchResumeContext(question)
}

export function buildAssistantPrompt(question: string, resumeContext: string, visionContext?: string) {
  return `### ROLE
You are an Elite AI Interview Coach. Your goal is to provide the user with clear, scannable, and strategic answers during a LIVE interview.

### CONTEXT FROM KNOWLEDGE VAULT
${resumeContext}

${visionContext ? `### VISUAL CONTEXT (From Snapshots)
${visionContext}` : ''}

### CURRENT INTERVIEWER QUESTION
"${question}"

### GUIDELINES FOR YOUR RESPONSE:
1. **SCANNABLE FIRST**: Use short bullet points. The user needs to read this while talking.
2. **CONFIDENT TONE**: Start with a strong "hook" or direct answer.
3. **STRATEGIC BRIDGING**: Explicitly link the answer to a specific project or achievement found in the context.
4. **THE "INTERVIEW TIP"**: At the end, provide a 1-sentence "Pro-Tip" on delivery (e.g., "Mention this with a smile," "Pause for 2 seconds after this point").
5. **CONCISE**: Keep the total response under 100 words.

### RESPONSE STRUCTURE:
**Suggested Answer:**
• [Strong Opening]
• [Key Achievement/Point 1]
• [Key Achievement/Point 2]
• [Conclusion/Call to Action]

**💡 Pro-Tip:** [Strategic coaching advice]`;
}

export async function streamAssistantResponse(
  prompt: string,
  onChunk: (chunk: string) => void,
  onComplete: () => void
) {
  if (hasOpenAIKey() || useOllama()) {
    try {
      await streamChatCompletion(
        prompt,
        onChunk,
        onComplete,
        (error) => {
          onChunk(`\n[Assistant fallback after streaming error: ${error.message}]\n`)
          onComplete()
        }
      )
      return
    } catch (error) {
      onChunk(`\n[Assistant fallback after error: ${String(error)}]\n`)
    }
  }

  const response = `This is a simulated real-time response for the prompt: ${prompt.slice(0, 200)}...` 
    + `\n\nFocus on the user's experience, mention resume context, and keep the answer clear.`

  const chunks = response.split(/(\s+)/).filter(Boolean)
  let index = 0

  const interval = setInterval(() => {
    if (index >= chunks.length) {
      clearInterval(interval)
      onComplete()
      return
    }

    onChunk(chunks[index])
    index += 1
  }, 120)

  return () => {
    clearInterval(interval)
    onComplete()
  }
}

export async function streamVisionAssistantResponse(
  prompt: string,
  base64Image: string,
  onChunk: (chunk: string) => void,
  onComplete: () => void
) {
  if (hasOpenAIKey() || useOllama()) {
    try {
      await streamVisionCompletion(
        prompt,
        base64Image,
        onChunk,
        onComplete,
        (error) => {
          onChunk(`\n[Vision error: ${error.message}]\n`)
          onComplete()
        }
      )
      return
    } catch (error) {
      onChunk(`\n[Vision fallback error: ${String(error)}]\n`)
      onComplete()
    }
  } else {
    onChunk('\n[Vision features require an OpenAI API key or a local vision model in Ollama (e.g., llava).]\n')
    onComplete()
  }
}
