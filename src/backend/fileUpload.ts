import fs from 'fs/promises'
import pdfParse from 'pdf-parse'

export async function extractTextFromPdf(filePath: string): Promise<string> {
  try {
    const data = await fs.readFile(filePath)
    const parsed = await pdfParse(data)
    return (parsed.text || '').trim()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Failed to parse PDF file: ${message}`)
  }
}

export async function extractTextFromPlainFile(filePath: string): Promise<string> {
  return (await fs.readFile(filePath, 'utf-8')).trim()
}
