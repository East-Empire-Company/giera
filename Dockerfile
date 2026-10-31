FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM oven/bun:1
WORKDIR /app
ENV PORT=8080 GIERA_DATA_DIR=/data
COPY --from=build /app/dist ./dist
COPY server ./server
COPY src/shared ./src/shared
COPY agents ./agents
EXPOSE 8080
CMD ["bun", "server/index.ts"]
