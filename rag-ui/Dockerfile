FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json ./
# npm install generates the lock file automatically — no package-lock.json required
RUN npm install

COPY public/ ./public/
COPY src/ ./src/

ARG REACT_APP_API_URL=/api
ENV REACT_APP_API_URL=$REACT_APP_API_URL

RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/build /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://localhost/ || exit 1
CMD ["nginx", "-g", "daemon off;"]
