FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV NODE_ENV=production DB_PATH=/data/gospel-banker.db MEDIA_DIR=/data/media
VOLUME /data
EXPOSE 3000
CMD ["npm", "start"]
