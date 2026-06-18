# The lockstep relay is a single zero-dependency Node file, so the image is tiny.
# Build context is this server/ directory (see fly.toml), so we copy relay.mjs directly.
FROM node:20-alpine
WORKDIR /app
COPY relay.mjs ./
ENV PORT=8787
EXPOSE 8787
CMD ["node", "relay.mjs"]
