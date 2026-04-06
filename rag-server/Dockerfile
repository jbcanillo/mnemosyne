FROM node:20-alpine

# Install system dependencies for OCR and PDF processing
# tesseract-ocr: OCR engine
# tesseract-ocr-data-eng: English language data for Tesseract
# poppler-utils: PDF to image conversion (pdftoppm)
# python3 make g++: build tools for native Node modules
RUN apk add --no-cache \
    tesseract-ocr \
    tesseract-ocr-data-eng \
    poppler-utils \
    python3 \
    make \
    g++ \
    bash

WORKDIR /app

COPY rag-server/package.json ./
# npm install generates lock file automatically
RUN npm install --omit=dev

COPY rag-server/src/ ./src/

# Create required directories  
RUN mkdir -p /var/log/rag /tmp/rag-uploads /app/backups /data/config /data/documents

# Try to copy scripts if available (optional)
COPY scripts/ /app/scripts/

# Make scripts executable
RUN find /app/scripts -type f -name "*.sh" -exec chmod +x {} + 2>/dev/null || true

# Note: Running as root to allow writing to Docker named volumes.
# For production, consider using bind mounts with proper ownership or an entrypoint that chowns volumes.

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD wget -qO- http://localhost:3001/health || exit 1

CMD ["node", "src/index.js"]
