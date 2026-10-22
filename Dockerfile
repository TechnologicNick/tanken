FROM oven/bun:1.4.4 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM oven/bun:1.4.4
WORKDIR /app
COPY --from=build --chown=bun:bun /app/package.json ./package.json
COPY --from=build --chown=bun:bun /app/src ./src
COPY --from=build --chown=bun:bun /app/migrations ./migrations
COPY --from=build --chown=bun:bun /app/scripts ./scripts
COPY --from=build --chown=bun:bun /app/dist ./dist
USER bun
ENV HOST=0.0.0.0 PORT=3000 NODE_ENV=production
CMD ["bun", "run", "src/main.ts"]
