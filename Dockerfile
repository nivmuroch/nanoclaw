FROM node:22-slim

# Install Claude Code globally — required by the Agent SDK to run sessions
# node:22-slim has a built-in 'node' user (UID 1000); we'll run as that user
# Claude Code refuses --dangerously-skip-permissions as root
RUN npm install -g @anthropic-ai/claude-code

WORKDIR /app

# NanoClaw production dependencies
COPY package*.json ./
RUN npm ci

# Agent-runner dependencies
COPY container/agent-runner/package*.json ./container/agent-runner/
RUN cd container/agent-runner && npm ci

# Copy source and build both packages
COPY . .
RUN npm run build
RUN cd container/agent-runner && npm run build

COPY start.sh /start.sh
RUN chmod +x /start.sh

# Keep a read-only seed copy of groups so start.sh can initialize the volume on first boot
RUN cp -r /app/groups /app/groups-seed
# Migration bundle — seeded to volume on first boot, then ignored
COPY migration/ /app/migration/


CMD ["/start.sh"]
