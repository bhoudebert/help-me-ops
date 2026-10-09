# The MCP server over HTTP for a team (ADR 0015, 0016). The image holds the
# server and the shipped addons; your workspace (ops.config.json, playbooks,
# knowledge, your own addons) is mounted at /workspace, never baked in.
#
#   docker build -t help-me-ops .
#   docker run --rm -p 127.0.0.1:8808:8808 -v ./my-workspace:/workspace:ro \
#     -e OPS_MCP_TOKENS=alice:sha256:<hash> -e OPS_MCP_PUBLIC_HOSTS=localhost:8808 help-me-ops
FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY src ./src
COPY addons ./addons
COPY templates ./templates
ENV OPS_WORKSPACE=/workspace \
    OPS_MCP_HOST=0.0.0.0 \
    OPS_MCP_PORT=8808
VOLUME ["/workspace"]
EXPOSE 8808
USER node
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.OPS_MCP_PORT+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
ENTRYPOINT ["node", "src/mcp-http.ts"]
