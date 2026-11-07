# TextSnap: Node server + Chromium (Text/HTML → PDF) + LibreOffice (Word/Excel/PPT → PDF)
# Build:  docker build -t textsnap .
# Run:    docker run -p 5173:5173 --env-file .env textsnap
FROM node:22-bookworm-slim

# Chromium, LibreOffice and fonts. The Noto fonts cover Bengali, Hindi, Arabic, Chinese/Japanese/Korean,
# so documents in those languages render correctly instead of showing empty boxes.
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium \
      libreoffice-writer libreoffice-calc libreoffice-impress libreoffice-draw libreoffice-core \
      fonts-noto-core fonts-noto-cjk fonts-noto-color-emoji fonts-liberation2 fonts-dejavu-core \
      fontconfig ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && fc-cache -f

ENV NODE_ENV=production \
    CHROME_PATH=/usr/bin/chromium \
    SOFFICE_PATH=/usr/bin/soffice \
    TRUST_PROXY=1 \
    PORT=5173

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .

# Run as the image's built-in non-root "node" user (uid 1000, which Hugging Face Spaces also expects)
RUN chown -R node:node /app
USER node

EXPOSE 5173
CMD ["node", "server.js"]
