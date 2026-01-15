# Dockerfile para RECARGAR-BS-SEAGM
FROM ghcr.io/puppeteer/puppeteer:21.6.1

WORKDIR /app

# Copiar archivos de dependencias
COPY package*.json ./

# Instalar dependencias
RUN npm ci --only=production

# Copiar código
COPY . .

# Variables de entorno por defecto
ENV NODE_ENV=production
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

# Puerto
EXPOSE 3002

# Comando de inicio
CMD ["node", "server.js"]
