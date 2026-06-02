declare module 'pdf-parse' {
  import { Buffer } from 'buffer'

  export interface PdfParseResult {
    text: string
    numpages: number
    numrender: number
    info: any
    metadata: any
    version: string
  }

  function pdf(data: Buffer | Uint8Array): Promise<PdfParseResult>
  export default pdf
}
