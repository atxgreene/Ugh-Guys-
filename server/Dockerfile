# The lockstep relay is a single zero-dependency Node file, so the image is tiny.
# Build context is this server/ directory (see fly.toml), so we copy relay.mjs directly.
FROM node:20-alpine
WORKDIR /app
COPY relay.mjs ./
# In a container we DO want to listen on all interfaces — Fly's proxy terminates TLS
# and forwards to us privately. (A bare local `npm run relay` stays on 127.0.0.1.)
ENV PORT=8787
ENV HOST=0.0.0.0
# Lock the relay to your game's origin in production, e.g.:
#   fly secrets set ALLOWED_ORIGINS="https://your-game.example.com"
EXPOSE 8787
CMD ["node", "relay.mjs"]
