# Development/review environment. Hosted Firebase, Supabase and Gemini credentials
# are supplied at runtime; they are never copied into this image.
FROM node:22-bookworm-slim
WORKDIR /app
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci && chown -R node:node /app
COPY --chown=node:node . .
USER node
EXPOSE 5173 3001
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
