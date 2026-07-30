# syntax=docker/dockerfile:1

# --- build -------------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app

# Copy manifests first so `npm ci` is cached until dependencies actually change.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
RUN npm ci

COPY . .
RUN npm run build

# --- runtime -----------------------------------------------------------------
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

# The server is bundled into a single ESM file, so the only thing it still
# needs from node_modules is `ws` (kept external, and dependency-free itself).
RUN printf '{"type":"module","private":true}' > package.json
COPY --from=build /app/node_modules/ws ./node_modules/ws
COPY --from=build /app/packages/server/dist ./packages/server/dist
COPY --from=build /app/packages/client/dist ./packages/client/dist

EXPOSE 3000
CMD ["node", "packages/server/dist/server.js"]
