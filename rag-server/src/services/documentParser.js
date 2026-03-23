const pdfParse = require('pdf-parse');
const xlsx = require('xlsx');
const mammoth = require('mammoth');
const fs = require('fs');
const path = require('path');
const { logger } = require('../utils/logger');

const CHUNK_SIZE = parseInt(process.env.CHUNK_SIZE || '500');
const CHUNK_OVERLAP = parseInt(process.env.CHUNK_OVERLAP || '50');

class DocumentParser {
  /**
   * Parse a file and return raw text
   */
  async parse(filePath, fileType) {
    const ext = (fileType || path.extname(filePath)).toLowerCase().replace('.', '');
    
    switch (ext) {
      case 'pdf':
        return this.parsePDF(filePath);
      case 'xlsx':
      case 'xls':
      case 'csv':
        return this.parseSpreadsheet(filePath);
      case 'md':
      case 'markdown':
        return this.parseMarkdown(filePath);
      case 'docx':
      case 'doc':
        return this.parseWord(filePath);
      case 'txt':
        return fs.readFileSync(filePath, 'utf8');
      default:
        throw new Error(`Unsupported file type: ${ext}`);
    }
  }

  async parsePDF(filePath) {
    const buffer = fs.readFileSync(filePath);
    const data = await pdfParse(buffer);
    return data.text;
  }

  parseSpreadsheet(filePath) {
    const workbook = xlsx.readFile(filePath);
    let text = '';
    
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '' });
      
      if (rows.length === 0) continue;
      
      text += `\n\n=== Sheet: ${sheetName} ===\n`;
      
      // Treat first row as headers
      const headers = rows[0].map(h => String(h).trim());
      
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const rowData = headers.map((h, j) => `${h}: ${String(row[j] || '').trim()}`).join(' | ');
        if (rowData.replace(/\|/g, '').trim()) {
          text += rowData + '\n';
        }
      }
    }
    
    return text;
  }

  parseMarkdown(filePath) {
    let text = fs.readFileSync(filePath, 'utf8');
    // Strip markdown syntax but keep structure as plain text
    text = text
      .replace(/#{1,6}\s/g, '')         // headers
      .replace(/\*\*(.*?)\*\*/g, '$1') // bold
      .replace(/\*(.*?)\*/g, '$1')     // italic
      .replace(/`{1,3}[^`]*`{1,3}/g, '') // code
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links
      .replace(/^\s*[-*+]\s/gm, '')    // bullets
    return text;
  }

  async parseWord(filePath) {
    const buffer = fs.readFileSync(filePath);
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  /**
   * Split text into overlapping chunks
   * @param {string} text
   * @param {string} documentId
   * @param {Object} metadata
   * @returns {Array<{id, text, metadata}>}
   */
  chunkText(text, documentId, metadata) {
    // Clean text
    const cleaned = text
      .replace(/\r\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/\t/g, ' ')
      .replace(/ {2,}/g, ' ')
      .trim();

    const words = cleaned.split(/\s+/);
    const chunks = [];
    let chunkIndex = 0;
    let i = 0;

    while (i < words.length) {
      const chunkWords = words.slice(i, i + CHUNK_SIZE);
      const chunkText = chunkWords.join(' ');
      
      if (chunkText.trim().length > 20) { // Skip tiny chunks
        chunks.push({
          id: `${documentId}_chunk_${chunkIndex}`,
          text: chunkText,
          metadata: {
            ...metadata,
            documentId,
            chunkIndex,
            chunkTotal: Math.ceil(words.length / (CHUNK_SIZE - CHUNK_OVERLAP))
          }
        });
        chunkIndex++;
      }
      
      i += CHUNK_SIZE - CHUNK_OVERLAP;
    }

    logger.info(`Chunked document ${documentId}: ${chunks.length} chunks from ${words.length} words`);
    return chunks;
  }
}

module.exports = new DocumentParser();
