# GitHub MCP Server

MCP (Model Context Protocol) server for interacting with GitHub.

> **Note:** This is a fork of [smithery-ai/mcp-servers/github](https://github.com/smithery-ai/mcp-servers/tree/main/github).

### What's Changed in This Fork

- **Self-hosted VPS deployment** - Added Streamable HTTP transport for hosting on your own server
- **Docker support** - Dockerfile and docker-compose.yml for containerized deployment
- **Nginx reverse proxy config** - Ready-to-use nginx location block
- **GitHub Actions auto-deploy** - Automatic deployment on push to main
- **Analytics dashboard** - Built-in usage tracking and visual dashboard
- **Flexible authentication** - Support for token via query param, header, or environment variable

**MCP Endpoint:** `https://mcp.techmavie.digital/github/mcp`

**Analytics Dashboard:** [`https://mcp.techmavie.digital/github/analytics/dashboard`](https://mcp.techmavie.digital/github/analytics/dashboard)

## Quick Start (Hosted Server)

The easiest way to use this MCP server is via the hosted endpoint. **No installation required!**

### Client Configuration

For Claude Desktop / Cursor / Windsurf, add to your MCP configuration:

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

> **Note:** Replace `YOUR_GITHUB_TOKEN` with your [GitHub Personal Access Token](https://github.com/settings/personal-access-tokens).

### Test with MCP Inspector

```bash
npx @modelcontextprotocol/inspector
# Select "Streamable HTTP"
# Enter URL: https://mcp.techmavie.digital/github/mcp?token=YOUR_GITHUB_TOKEN
```

### Test with curl

```bash
# List all available tools
curl -X POST "https://mcp.techmavie.digital/github/mcp?token=YOUR_GITHUB_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# Call the hello tool
curl -X POST "https://mcp.techmavie.digital/github/mcp?token=YOUR_GITHUB_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"hello","arguments":{}}}'
```

## Authentication

The server supports three ways to provide a GitHub token:

1. **Query Parameter** (recommended): `?token=YOUR_TOKEN`
2. **Header**: `X-GitHub-Token: YOUR_TOKEN`
3. **Environment Variable**: `GITHUB_PERSONAL_ACCESS_TOKEN` (server default)

## Available Tools

### Repository Tools
Tools for managing GitHub repositories:

- `get_commit`: Get details for a specific commit
- `list_commits`: Get list of commits in a branch
- `list_branches`: List branches in a repository
- `create_or_update_file`: Create or update a file in a repository
- `create_repository`: Create a new GitHub repository
- `get_file_contents`: Get contents of a file or directory
- `fork_repository`: Fork a repository to your account or organization

### Search Tools

Tools for searching GitHub:

- `search_repositories`: Search for GitHub repositories
- `search_code`: Search for code across GitHub repositories
- `search_users`: Search for GitHub users

### Issue Tools

Tools for managing GitHub issues:

- `get_issue`: Get details of a specific issue
- `add_issue_comment`: Add a comment to an issue
- `search_issues`: Search for issues across repositories
- `create_issue`: Create a new issue
- `list_issues`: List issues in a repository
- `update_issue`: Update an existing issue

### Pull Request Tools

Tools for managing pull requests:

- `get_pull_request`: Get details of a specific pull request
- `update_pull_request`: Update an existing pull request
- `list_pull_requests`: List pull requests in a repository
- `merge_pull_request`: Merge a pull request
- `get_pull_request_files`: Get files changed in a pull request
- `get_pull_request_status`: Get the status of a pull request
- `get_pull_request_review_comments`: Get review comments (line-by-line code comments) for a pull request
- `create_pull_request_review_comment`: Create a review comment on a pull request

## Self-Hosting (VPS)

If you prefer to run your own instance, see [deploy/DEPLOYMENT.md](deploy/DEPLOYMENT.md) for detailed VPS deployment instructions with Docker and Nginx.

```bash
# Using Docker
docker compose up -d --build

# Or run directly
npm run build:tsc
npm run start:http
```

## Local Development

```bash
# Install dependencies
npm install

# Run HTTP server in development mode
npm run dev:http

# Or build and run production version
npm run build:tsc
npm run start:http

# Test health endpoint
curl http://localhost:8080/health
```

## Project Structure

```
├── src/
│   ├── index.ts              # Main MCP server entry point (Smithery)
│   ├── http-server.ts        # Streamable HTTP server for VPS
│   └── tools/
│       ├── issues.ts         # Issue management tools
│       ├── pullrequests.ts   # Pull request tools
│       ├── repositories.ts   # Repository tools
│       └── search.ts         # Search tools
├── deploy/
│   ├── DEPLOYMENT.md         # VPS deployment guide
│   └── nginx-mcp.conf        # Nginx reverse proxy config
├── .github/
│   └── workflows/
│       └── deploy-vps.yml    # GitHub Actions auto-deploy
├── docker-compose.yml        # Docker deployment config
├── Dockerfile                # Container build config
├── package.json              # Project dependencies
├── tsconfig.json             # TypeScript configuration
└── README.md                 # This file
```

## License

[MIT](LICENSE)
