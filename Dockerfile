FROM node:24-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
ENV NODE_ENV=production
# Mount a Railway volume at /data so leads survive redeploys.
ENV DATA_DIR=/data
EXPOSE 5260
CMD ["npm", "start"]
