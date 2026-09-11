FROM oven/bun:1.3.14
WORKDIR /app
COPY package.json tsconfig.json ./
COPY src ./src
RUN bun install --ignore-scripts && bun run build
EXPOSE 8080
CMD ["bun", "run", "dist/serve/index.js"]
