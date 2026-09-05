FROM oven/bun:1.3.14
WORKDIR /app
COPY package.json ./
RUN bun install --production --ignore-scripts
COPY dist ./dist
COPY openapi.json hasna.contract.json ./
RUN mkdir /data && chown bun:bun /data
USER bun
EXPOSE 8080
HEALTHCHECK --interval=20s --timeout=5s CMD bun -e 'fetch("http://127.0.0.1:8080/ready").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))'
CMD ["bun", "dist/serve/index.js", "--host", "0.0.0.0", "--port", "8080"]
