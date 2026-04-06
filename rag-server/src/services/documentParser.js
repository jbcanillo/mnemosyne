const pdfParse = require('pdf-parse');
const xlsx = require('xlsx');
const mammoth = require('mammoth');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { createWorker } = require('tesseract.js');
const { logger } = require('../utils/logger');

const CHUNK_SIZE = parseInt(process.env.CHUNK_SIZE || '500');
const CHUNK_OVERLAP = parseInt(process.env.CHUNK_OVERLAP || '50');

// OCR Configuration
const OCR_CONFIG = {
  lang: process.env.OCR_LANG || 'eng',
  minTextLength: parseInt(process.env.OCR_MIN_TEXT_LENGTH || '10'),
  enableOcr: process.env.OCR_ENABLED !== 'false' // default true
};

class DocumentParser {
  /**
   * Parse a file and return raw text
   */
  async parse(filePath, fileType) {
    const ext = (fileType || path.extname(filePath)).toLowerCase().replace('.', '');
    
    switch (ext) {
      case 'pdf':
        return this.parsePDF(filePath);
      case 'png':
      case 'jpg':
      case 'jpeg':
      case 'gif':
      case 'bmp':
      case 'tiff':
      case 'tif':
        return this.parseImage(filePath);
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
    logger.info(`[PDF] Extracting text from ${filePath}`);
    
    // First try: direct text extraction
    const buffer = fs.readFileSync(filePath);
    const data = await pdfParse(buffer);
    const text = data.text || '';
    
    logger.info(`[PDF] Direct extraction yielded ${text.length} characters`);
    
    // If we got sufficient text, return it
    if (text.trim().length >= OCR_CONFIG.minTextLength) {
      return text;
    }
    
    logger.info(`[PDF] Insufficient text extracted, falling back to OCR`);
    
    // Second try: OCR the PDF
    return await this.parsePDFWithOCR(filePath);
  }
  
  async parsePDFWithOCR(filePath) {
    logger.info(`[PDF-OCR] Starting OCR on PDF`);
    
    return new Promise((resolve, reject) => {
      // Create a temporary directory for the images
      const tmpDir = fs.mkdtempSync('/tmp/ocr-pdf-');
      const baseName = path.basename(filePath, path.extname(filePath));
      
      try {
        // Use pdftoppm to convert PDF to PNG images
        // -r 300 sets DPI to 300 for better OCR accuracy
        // Output format: ppm (easier to convert) or png directly if available
        const cmd = `pdftoppm -r 300 -png "${filePath}" "${tmpDir}/${baseName}"`;
        
        exec(cmd, async (err, stdout, stderr) => {
          if (err) {
            fs.rmSync(tmpDir, { recursive: true, force: true });
            logger.error(`[PDF-OCR] pdftoppm failed: ${err.message}`);
            reject(new Error(`Failed to convert PDF to images: ${err.message}`));
            return;
          }
          
          // Find all generated PNG files
          const files = fs.readdirSync(tmpDir).filter(f => f.endsWith('.png'));
          logger.info(`[PDF-OCR] Converted PDF to ${files.length} images`);
          
          if (files.length === 0) {
            fs.rmSync(tmpDir, { recursive: true, force: true });
            reject(new Error('No pages could be converted from PDF for OCR'));
            return;
          }
          
          // Sort files by page number (pdftoppm names them base_name-0001.png, etc.)
          files.sort((a, b) => {
            const aNum = parseInt(a.match(/-(\d+)\.png$/)[1]);
            const bNum = parseInt(b.match(/-(\d+)\.png$/)[1]);
            return aNum - bNum;
          });
          
          // Perform OCR on each image
          const worker = await createWorker(OCR_CONFIG.lang);
          
          try {
            let fullText = '';
            for (let i = 0; i < files.length; i++) {
              const imgPath = path.join(tmpDir, files[i]);
              logger.info(`[PDF-OCR] Processing page ${i + 1}/${files.length}`);
              
              try {
                const { data } = await worker.recognize(imgPath);
                const pageText = data.text;
                
                if (pageText && pageText.trim()) {
                  fullText += pageText + '\n\n';
                }
              } catch (ocrErr) {
                logger.warn(`[PDF-OCR] Error on page ${i + 1}: ${ocrErr.message}`);
                // Continue with next page
              }
            }
            
            await worker.terminate();
            
            // Cleanup temp directory
            fs.rmSync(tmpDir, { recursive: true, force: true });
            
            if (fullText.trim().length < OCR_CONFIG.minTextLength) {
              throw new Error('OCR produced insufficient text content');
            }
            
            logger.info(`[PDF-OCR] Successfully extracted ${fullText.length} characters`);
            resolve(fullText);
            
          } catch (workerErr) {
            await worker.terminate();
            fs.rmSync(tmpDir, { recursive: true, force: true });
            throw workerErr;
          }
        });
      } catch (outerErr) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        reject(outerErr);
      }
    });
  }

  async parseImage(filePath) {
    logger.info(`[Image] Performing OCR on ${filePath}`);
    
    if (!OCR_CONFIG.enableOcr) {
      throw new Error('OCR is disabled. Cannot process image files.');
    }
    
    const worker = await createWorker(OCR_CONFIG.lang);
    
    try {
      const { data } = await worker.recognize(filePath);
      const text = data.text;
      
      await worker.terminate();
      
      if (!text || text.trim().length < OCR_CONFIG.minTextLength) {
        throw new Error('OCR produced insufficient text content from image');
      }
      
      logger.info(`[Image] Extracted ${text.length} characters`);
      return text;
      
    } catch (err) {
      await worker.terminate();
      logger.error(`[Image] OCR failed: ${err.message}`);
      throw new Error(`OCR failed for image: ${err.message}`);
    }
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
