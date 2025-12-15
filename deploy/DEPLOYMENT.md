# VPS Deployment Guide for GitHub MCP

This guide explains how to deploy the GitHub MCP server on your VPS at `mcp.techmavie.digital/github`.

## Prerequisites

- VPS with Ubuntu/Debian
- Docker and Docker Compose installed
- Nginx installed
- Domain `mcp.techmavie.digital` pointing to your VPS IP
- SSL certificate (via Certbot/Let's Encrypt)
- GitHub Personal Access Token (optional, can be provided per-request)

## Architecture

```
Client (Claude, Cursor, etc.)
    ↓ HTTPS
https://mcp.techmavie.digital/github/mcp
    ↓
Nginx (SSL termination + reverse proxy)
    ↓ HTTP
Docker Container (port 8084 → 8080)
    ↓
GitHub API
```

## Deployment Steps

### 1. SSH into your VPS

```bash
ssh root@your-vps-ip
```

### 2. Create directory for the MCP server

```bash
mkdir -p /opt/mcp-servers/github
cd /opt/mcp-servers/github
```

### 3. Clone the repository

```bash
git clone https://github.com/hithereiamaliff/mcp-github.git .
```

### 4. Create environment file (optional)

If you want a default GitHub token for all requests:

```bash
nano .env
```

Add your GitHub Personal Access Token:
```env
GITHUB_PERSONAL_ACCESS_TOKEN=ghp_your_token_here
```

> **Note:** Users can also provide their own token via `?token=` query parameter or `X-GitHub-Token` header.

### 5. Build and start the Docker container

```bash
docker compose up -d --build
```

### 6. Verify the container is running

```bash
docker compose ps
docker compose logs -f
```

### 7. Test the health endpoint

```bash
curl http://localhost:8084/health
```

### 8. Configure Nginx

Add the location block from `deploy/nginx-mcp.conf` to your existing nginx config for `mcp.techmavie.digital`:

```bash
# Edit your existing nginx config
sudo nano /etc/nginx/sites-available/mcp.techmavie.digital

# Add the location block from deploy/nginx-mcp.conf inside the server block

# Test nginx config
sudo nginx -t

# Reload nginx
sudo systemctl reload nginx
```

### 9. Test the MCP endpoint

```bash
# Test health endpoint through nginx
curl https://mcp.techmavie.digital/github/health

# Test MCP endpoint (with token)
curl -X POST "https://mcp.techmavie.digital/github/mcp?token=YOUR_GITHUB_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## Client Configuration

### For Claude Desktop / Cursor / Windsurf

Add to your MCP configuration:

```json
{
  "mcpServers": {
    "github": {
      "transport": "streamable-http",
      "url": "https://mcp.techmavie.digital/github/mcp?token=YOUR_GITHUB_TOKEN"
    }
  }
}
```

### For MCP Inspector

```bash
npx @modelcontextprotocol/inspector
# Select "Streamable HTTP"
# Enter URL: https://mcp.techmavie.digital/github/mcp?token=YOUR_GITHUB_TOKEN
```

## Authentication

The server supports three ways to provide a GitHub token:

1. **Query Parameter** (recommended for clients): `?token=YOUR_TOKEN`
2. **Header**: `X-GitHub-Token: YOUR_TOKEN`
3. **Environment Variable**: `GITHUB_PERSONAL_ACCESS_TOKEN` (server default)

If no token is provided, the server returns a 401 error.

## Management Commands

### View logs

```bash
cd /opt/mcp-servers/github
docker compose logs -f
```

### Restart the server

```bash
docker compose restart
```

### Update to latest version

```bash
git pull origin main
docker compose up -d --build
```

### Stop the server

```bash
docker compose down
```

## GitHub Actions Auto-Deploy

The repository includes a GitHub Actions workflow (`.github/workflows/deploy-vps.yml`) that automatically deploys to your VPS when you push to the `main` branch.

### Required GitHub Secrets

Set these in your repository settings (Settings → Secrets and variables → Actions):

| Secret | Description |
|--------|-------------|
| `VPS_HOST` | Your VPS IP address |
| `VPS_USERNAME` | SSH username (e.g., root) |
| `VPS_SSH_KEY` | Your private SSH key |
| `VPS_PORT` | SSH port (usually 22) |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 8080 | HTTP server port (internal) |
| `HOST` | 0.0.0.0 | Bind address |
| `GITHUB_PERSONAL_ACCESS_TOKEN` | (optional) | Default GitHub token |

## Port Allocation

Based on your existing MCP servers:
- **8080** - Malaysia Transit MCP
- **3001** - Keywords Everywhere MCP
- **8083** - Malaysia Open Data MCP
- **8084** - GitHub MCP (this server)

## Troubleshooting

### Container not starting

```bash
docker compose logs mcp-github
```

### Nginx 502 Bad Gateway

- Check if container is running: `docker compose ps`
- Check container logs: `docker compose logs`
- Verify port binding: `docker port mcp-github`

### Test MCP connection

```bash
# List tools
curl -X POST "https://mcp.techmavie.digital/github/mcp?token=YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# Call hello tool
curl -X POST "https://mcp.techmavie.digital/github/mcp?token=YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"hello","arguments":{}}}'
```

## Available Tools

The GitHub MCP server provides the following tools:

### Search Tools
- `search_repositories` - Search for GitHub repositories
- `search_code` - Search for code across repositories
- `search_users` - Search for GitHub users

### Repository Tools
- `get_repository` - Get detailed repository information
- `list_branches` - List repository branches
- `get_file_contents` - Get file contents from a repository
- `create_repository` - Create a new repository
- `fork_repository` - Fork a repository

### Issue Tools
- `list_issues` - List repository issues
- `get_issue` - Get issue details
- `create_issue` - Create a new issue
- `update_issue` - Update an existing issue
- `add_issue_comment` - Add a comment to an issue

### Pull Request Tools
- `list_pull_requests` - List repository pull requests
- `get_pull_request` - Get pull request details
- `create_pull_request` - Create a new pull request
- `merge_pull_request` - Merge a pull request

## Security Notes

- The MCP server runs behind nginx with SSL
- GitHub tokens can be provided per-request (recommended)
- CORS is configured to allow all origins (required for MCP clients)
- Rate limiting can be added at nginx level if needed
