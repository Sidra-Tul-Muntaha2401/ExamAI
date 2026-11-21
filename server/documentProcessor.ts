import mammoth from 'mammoth';
import { extractText } from 'unpdf';
import { validateExtractedText, validateUploadMeta } from '../src/lib/examRules.ts';

export interface ProcessedDocumentResult {
  fileType: 'pdf' | 'docx';
  extractedText: string;
  wordCount: number;
}

export async function processUploadedDocument(
  buffer: Buffer,
  originalFilename: string,
  mimetype: string,
  sizeBytes: number
): Promise<ProcessedDocumentResult> {
  const metaCheck = validateUploadMeta(originalFilename, mimetype, sizeBytes);
  if (!metaCheck.valid || !metaCheck.fileType) {
    throw new Error(metaCheck.error || 'Invalid document upload.');
  }

  let rawText = '';

  if (metaCheck.fileType === 'pdf') {
    try {
      const uint8 = new Uint8Array(buffer);
      const pdfResult = await extractText(uint8, { mergePages: true });
      rawText = Array.isArray(pdfResult.text) ? pdfResult.text.join('\n') : String(pdfResult.text || '');
    } catch {
      throw new Error(
        'Unable to parse this PDF file. Ensure it is not password-protected or corrupted.'
      );
    }
  } else {
    try {
      const docxResult = await mammoth.extractRawText({ buffer });
      rawText = docxResult.value || '';
    } catch {
      throw new Error('Unable to parse this DOCX file. Ensure it is a valid Word (.docx) document.');
    }
  }

  const textCheck = validateExtractedText(rawText, metaCheck.fileType);
  if (!textCheck.valid) {
    throw new Error(textCheck.error || 'Insufficient text extracted from document.');
  }

  return {
    fileType: metaCheck.fileType,
    extractedText: textCheck.cleanedText,
    wordCount: textCheck.wordCount,
  };
}
