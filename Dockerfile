FROM node:20-slim

WORKDIR /app

# Copy root package.json and server package.json
COPY package.json ./
COPY server/package.json ./server/

# Install server dependencies
RUN npm install

# Copy server code
COPY server/ ./server/

# Hugging Face Spaces require the app to run on port 7860
EXPOSE 7860
ENV PORT=7860

CMD ["npm", "start"]
