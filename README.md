# GitHub MCP Server

Model Context Protocol server for GitHub repositories, issues, pull requests, branches, tags, commits, and search.

It ships with 34 tools across 5 categories and supports:

- CLI/stdio usage for local MCP clients
- self-hosted Streamable HTTP deployments
- hosted key-service mode with `usr_...` user keys
- an optional Smithery endpoint

## Quick Start

### Option 1: Self-hosted HTTP

Use header-based auth on `/github/mcp`:

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

`MCP_API_KEY` must be configured on the server or self-hosted `/mcp` requests will be rejected.

### Option 2: Hosted key-service mode

Preferred path-based form:

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

Compatibility query form:

```text
https://mcp.techmavie.digital/github/mcp?api_key=usr_YOUR_USER_KEY
```

### Option 3: CLI / stdio

```bash
npm install -g mcp-github
GITHUB_PERSONAL_ACCESS_TOKEN=ghp_your_token_here mcp-github
```

Example client config:

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "mcp-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_your_token_here"
      }
    }
  }
}
```

### Option 4: Legacy query-token mode

This is still supported for explicit requests only and is deprecated:

```text
https://mcp.techmavie.digital/github/mcp?token=YOUR_GITHUB_TOKEN
```

The server no longer falls back to its own `GITHUB_PERSONAL_ACCESS_TOKEN` for bare `/mcp` HTTP requests.

## Authentication Modes

| Mode | Endpoint | Client auth |
|------|----------|-------------|
| Self-hosted | `POST /github/mcp` | `X-API-Key` and `X-GitHub-Token` headers |
| Hosted key-service | `POST /github/mcp/usr_...` | user key in path |
| Hosted key-service compatibility | `POST /github/mcp?api_key=usr_...` | user key in query string |
| Smithery | `POST /github/smithery/mcp` | `X-GitHub-Token` header |
| Legacy | `POST /github/mcp?token=...` | explicit query token, deprecated |
| CLI | stdio | `GITHUB_PERSONAL_ACCESS_TOKEN` env var |

## Tool Categories

### Search Tools (3)

- `search_repositories`
- `search_code`
- `search_users`

### Repository Tools (12)

- `get_repository`
- `get_commit`
- `list_commits`
- `list_branches`
- `create_or_update_file`
- `create_repository`
- `get_file_contents`
- `fork_repository`
- `create_branch`
- `list_tags`
- `get_tag`
- `push_files`

### Issue Tools (7)

- `get_issue`
- `add_issue_comment`
- `search_issues`
- `create_issue`
- `list_issues`
- `update_issue`
- `get_issue_comments`

### Pull Request Tools (11)

- `get_pull_request`
- `update_pull_request`
- `list_pull_requests`
- `merge_pull_request`
- `get_pull_request_files`
- `get_pull_request_status`
- `update_pull_request_branch`
- `get_pull_request_comments`
- `create_pull_request`
- `get_pull_request_review_comments`
- `create_pull_request_review_comment`

### Utility Tools (1)

- `hello`

## Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | health check |
| `/mcp` | POST | self-hosted endpoint |
| `/mcp/:userKey` | POST | hosted key-service endpoint |
| `/smithery/mcp` | POST | Smithery endpoint when enabled |
| `/mcp-debug/open` | POST | diagnostics endpoint when enabled |
| `/.well-known/mcp/server-card.json` | GET | root-level discovery metadata |
| `/analytics` | GET | analytics JSON, requires `X-API-Key` |
| `/analytics/tools` | GET | analytics tool breakdown, requires `X-API-Key` |
| `/analytics/dashboard` | GET | analytics dashboard shell |

If this server is mounted under `/github`, the server-card route still lives at the host root:

```text
https://mcp.techmavie.digital/.well-known/mcp/server-card.json
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8080` | HTTP port |
| `HOST` | `0.0.0.0` | bind address |
| `GITHUB_PERSONAL_ACCESS_TOKEN` | unset | CLI/stdio token only |
| `MCP_API_KEY` | unset | required for self-hosted `/mcp` and analytics |
| `KEY_SERVICE_URL` | unset | hosted key-service resolver URL |
| `KEY_SERVICE_TOKEN` | unset | hosted key-service bearer token |
| `ALLOWED_ORIGINS` | `*` | comma-separated CORS allowlist |
| `MCP_PROTOCOL_VERSION` | `2025-11-25` | protocol version reported by HTTP server |
| `MCP_TRACE_HTTP` | `false` | enable sanitized request tracing |
| `ENABLE_MCP_DIAGNOSTICS` | `false` | enable `/mcp-debug/open` |
| `ENABLE_SMITHERY_ENDPOINT` | `false` | enable `/smithery/mcp` |
| `ANALYTICS_DIR` | `/app/data` | analytics storage directory |

## Local Development

```bash
npm install
npm run dev:http
```

Build and run production HTTP mode:

```bash
npm run build:tsc
npm run start:http
```

Run CLI mode:

```bash
GITHUB_PERSONAL_ACCESS_TOKEN=ghp_your_token_here npm run cli
```

## Project Structure

```text
mcp-github/
|-- src/
|   |-- index.ts
|   |-- http-server.ts
|   |-- cli.ts
|   |-- tools/
|   |-- resources/
|-- deploy/
|   |-- DEPLOYMENT.md
|   |-- nginx-mcp.conf
|-- .github/workflows/
|-- docker-compose.yml
|-- Dockerfile
|-- .env.sample
|-- package.json
|-- tsconfig.json
`-- README.md
```

## Security Notes

- Self-hosted `/mcp` fails closed when `MCP_API_KEY` is missing.
- Analytics fail closed when `MCP_API_KEY` is missing.
- Bare `/mcp` requests no longer inherit the server's own PAT.
- Recent analytics store hashed client IPs only.
- Request-scoped MCP servers and transports are used for HTTP requests.
- `?token=` remains available only as an explicit deprecated compatibility path.

## License

[MIT](LICENSE)
