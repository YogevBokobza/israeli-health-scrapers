# Playwright's own image, so the browser build matches the pinned Playwright version.
# Keep this tag in step with the `playwright` dependency in package.json — a mismatch
# is the usual cause of "Executable doesn't exist" at runtime.
FROM mcr.microsoft.com/playwright:v1.50.0-noble AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Drop dev dependencies from what ships.
RUN npm prune --omit=dev

FROM mcr.microsoft.com/playwright:v1.50.0-noble AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./

# Sessions, audit log and diagnostics all live here — mount it to persist a login.
RUN mkdir -p /data && chown -R pwuser:pwuser /data /app
ENV IHS_DATA_DIR=/data

# The image ships the Playwright user; running as root would let a compromised page
# exploit escape into the container with far more than it needs.
USER pwuser

# Read-only unless explicitly overridden. A misconfigured deployment should be
# useless, not permissive.
ENV IHS_MODE=readonly

ENTRYPOINT ["node", "dist/mcp/server.js"]
