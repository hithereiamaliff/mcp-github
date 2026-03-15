# GitHub MCP VPS Deployment Guide

Deploy the GitHub MCP server behind Nginx with Docker and Streamable HTTP.

This guide assumes the server is mounted at:

```text
https://mcp.techmavie.digital/github
```

## Auth Modes

| Mode | Endpoint | Required client auth |
|------|----------|----------------------|
| Self-hosted | `POST /github/mcp` | `X-API-Key` and `X-GitHub-Token` |
| Hosted key-service | `POST /github/mcp/usr_...` | hosted user key in path |
| Hosted compatibility | `POST /github/mcp?api_key=usr_...` | hosted user key in query |
| Smithery | `POST /github/smithery/mcp` | `X-GitHub-Token` |
| Legacy | `POST /github/mcp?token=...` | explicit deprecated query token |
| Diagnostics | `POST /github/mcp-debug/open` | none, when enabled |

## Required Environment

Create `.env` from `.env.sample`:

```bash
cp .env.sample .env
```

Minimum self-hosted configuration:

```env
MCP_API_KEY=your_secure_api_key
```

Hosted key-service configuration:

```env
KEY_SERVICE_URL=https://your-key-service.example.com/internal/resolve
KEY_SERVICE_TOKEN=your_bearer_token
```

Optional:

```env
ALLOWED_ORIGINS=https://claude.ai,https://your-domain.com
PUBLIC_BASE_PATH=/github
MCP_TRACE_HTTP=false
ENABLE_MCP_DIAGNOSTICS=false
ENABLE_SMITHERY_ENDPOINT=false
ANALYTICS_DIR=/app/data
```

`GITHUB_PERSONAL_ACCESS_TOKEN` is for CLI/stdio usage only. The HTTP server does not use it as an implicit fallback for `/mcp`.

## Deployment Steps

### 1. Prepare the VPS

```bash
ssh root@your-vps-ip
mkdir -p /opt/mcp-servers/github
cd /opt/mcp-servers/github
git clone https://github.com/hithereiamaliff/mcp-github.git .
mkdir -p /opt/mcp-credentials
```

### 2. Start the container

```bash
docker compose up -d --build
docker compose logs -f
```

### 3. Configure Nginx

Add the contents of [nginx-mcp.conf](./nginx-mcp.conf) to your Nginx server block:

```bash
sudo nano /etc/nginx/sites-available/mcp.techmavie.digital
sudo nginx -t
sudo systemctl reload nginx
```

## Verification Sequence

Run these in order.

### 1. Health check

```bash
curl https://mcp.techmavie.digital/github/health
```

### 2. Root-level server card

```bash
curl https://mcp.techmavie.digital/.well-known/mcp/server-card.json
```

### 3. Diagnostics, if enabled

```bash
curl -X POST "https://mcp.techmavie.digital/github/mcp-debug/open" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"probe","version":"1.0.0"}}}'
```

### 4. Self-hosted header auth

```bash
curl -X POST "https://mcp.techmavie.digital/github/mcp" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "X-API-Key: YOUR_MCP_API_KEY" \
  -H "X-GitHub-Token: YOUR_GITHUB_TOKEN" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

### 5. Hosted key-service path mode

```bash
curl -X POST "https://mcp.techmavie.digital/github/mcp/usr_YOUR_USER_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

### 6. Hosted key-service query compatibility mode

```bash
curl -X POST "https://mcp.techmavie.digital/github/mcp?api_key=usr_YOUR_USER_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

### 7. Legacy query-token mode

```bash
curl -X POST "https://mcp.techmavie.digital/github/mcp?token=YOUR_GITHUB_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

### 8. Analytics protection

Without a key:

```bash
curl https://mcp.techmavie.digital/github/analytics
```

With a key:

```bash
curl https://mcp.techmavie.digital/github/analytics \
  -H "X-API-Key: YOUR_MCP_API_KEY"
```

## Client Examples

### Self-hosted

```json
{
  "mcpServers": {
    "github": {
      "transport": "streamable-http",
      "url": "https://mcp.techmavie.digital/github/mcp",
      "headers": {
        "X-API-Key": "YOUR_MCP_API_KEY",
        "X-GitHub-Token": "YOUR_GITHUB_TOKEN"
      }
    }
  }
}
```

### Hosted key-service

```json
{
  "mcpServers": {
    "github": {
      "transport": "streamable-http",
      "url": "https://mcp.techmavie.digital/github/mcp/usr_YOUR_USER_KEY"
    }
  }
}
```

### CLI

```bash
GITHUB_PERSONAL_ACCESS_TOKEN=ghp_your_token_here mcp-github
```

## Environment Reference

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8080` | internal HTTP port |
| `HOST` | `0.0.0.0` | bind address |
| `GITHUB_PERSONAL_ACCESS_TOKEN` | unset | CLI/stdio token only |
| `MCP_API_KEY` | unset | required for self-hosted `/mcp` and analytics |
| `KEY_SERVICE_URL` | unset | hosted key-service URL |
| `KEY_SERVICE_TOKEN` | unset | hosted key-service bearer token |
| `ALLOWED_ORIGINS` | `*` | comma-separated CORS allowlist |
| `PUBLIC_BASE_PATH` | unset | public reverse-proxy mount path such as `/github` |
| `MCP_PROTOCOL_VERSION` | `2025-11-25` | protocol version |
| `MCP_TRACE_HTTP` | `false` | sanitized request tracing |
| `ENABLE_MCP_DIAGNOSTICS` | `false` | diagnostics endpoint |
| `ENABLE_SMITHERY_ENDPOINT` | `false` | Smithery endpoint |
| `ANALYTICS_DIR` | `/app/data` | analytics storage directory |

## Useful Commands

```bash
docker compose logs -f
docker compose ps
docker compose restart
docker compose up -d --build
docker compose down
```

## Troubleshooting

- `401` on `/mcp`: verify both `X-API-Key` and `X-GitHub-Token`.
- `503` on `/mcp`: `MCP_API_KEY` is not configured, so self-hosted mode is disabled.
- `503` on hosted key-service routes: check `KEY_SERVICE_URL` and `KEY_SERVICE_TOKEN`.
- `503` on `/analytics`: `MCP_API_KEY` is not configured for analytics protection.
- CORS failures: verify `ALLOWED_ORIGINS` includes the client origin, or leave it unset to allow `*`.
- Empty initialize responses: enable `MCP_TRACE_HTTP=true` and test `/mcp-debug/open` first.

## GitHub Actions

The repository already includes `.github/workflows/deploy-vps.yml` for deploy-on-push to `main`.
