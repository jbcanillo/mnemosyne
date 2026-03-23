FROM node:20-alpine

# Only install what's actually needed for pdf-parse and xlsx
RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package.json ./
# npm install generates lock file automatically
RUN npm install --omit=dev

COPY src/ ./src/

# Create required directories
RUN mkdir -p /var/log/rag /tmp/rag-uploads

# Run as non-root
RUN addgroup -S raguser && adduser -S raguser -G raguser
RUN chown -R raguser:raguser /app /var/log/rag /tmp/rag-uploads
USER raguser

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD wget -qO- http://localhost:3001/health || exit 1

CMD ["node", "src/index.js"]
