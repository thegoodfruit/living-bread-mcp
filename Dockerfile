# The Living Bread MCP server, runnable anywhere: the same Worker, served locally by wrangler.
# Listens on 8080 at /mcp (Streamable HTTP). The stored King James text is in assets/bible/books.
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
ENV PORT=8080
EXPOSE 8080
CMD ["npx", "wrangler", "dev", "--ip", "0.0.0.0", "--port", "8080", "--local"]
