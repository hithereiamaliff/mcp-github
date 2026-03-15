#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import createStatelessServer, { configSchema } from './index.js';

async function main() {
  const { GITHUB_PERSONAL_ACCESS_TOKEN } = process.env;

  if (!GITHUB_PERSONAL_ACCESS_TOKEN) {
    console.error('ERROR: Missing required environment variable:');
    console.error('- GITHUB_PERSONAL_ACCESS_TOKEN: GitHub Personal Access Token');
    console.error('\nCreate one at: https://github.com/settings/personal-access-tokens');
    console.error('Then set the environment variable in your shell or MCP client config.');
    process.exit(1);
  }

  try {
    const config = configSchema.parse({
      githubPersonalAccessToken: GITHUB_PERSONAL_ACCESS_TOKEN,
    });

    const server = createStatelessServer({ config });

    const transport = new StdioServerTransport();
    await server.connect(transport);

    console.error('GitHub MCP Server started successfully (stdio mode)');
    console.error('Listening for MCP requests...');
  } catch (error) {
    console.error('Failed to start GitHub MCP Server:', error);
    process.exit(1);
  }
}

process.on('SIGINT', () => {
  console.error('\nShutting down GitHub MCP Server...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.error('\nShutting down GitHub MCP Server...');
  process.exit(0);
});

main().catch((error) => {
  console.error('Unexpected error:', error);
  process.exit(1);
});
