#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { Octokit } from "octokit"
import { z } from "zod"
import { registerIssueTools } from "./tools/issues.js"
import { registerPullRequestTools } from "./tools/pullrequests.js"
import { registerRepositoryTools } from "./tools/repositories.js"
import { registerSearchTools } from "./tools/search.js"
import { registerRepositoryResource } from "./resources/repository_resource.js"

export const configSchema = z.object({
	githubPersonalAccessToken: z.string().describe("GitHub personal access token for authentication. Create one at: https://github.com/settings/personal-access-tokens"),
})

/**
 * Registers all tools and resources on a McpServer instance.
 * Used by both Smithery (index.ts) and HTTP (http-server.ts) entry points.
 */
export function registerAllToolsAndResources(server: McpServer, octokit: Octokit): void {
	registerSearchTools(server, octokit)
	registerIssueTools(server, octokit)
	registerRepositoryTools(server, octokit)
	registerPullRequestTools(server, octokit)
	registerRepositoryResource(server, octokit)

	// Hello tool — verifies MCP server connectivity
	server.tool(
		"hello",
		"A simple test tool to verify that the MCP server is working correctly",
		{},
		async () => ({
			content: [
				{
					type: "text",
					text: JSON.stringify({
						message: "Hello from GitHub MCP Server!",
						timestamp: new Date().toISOString(),
					}, null, 2),
				},
			],
		}),
	)
}

export default function ({ config }: { config: z.infer<typeof configSchema> }) {
	try {
		console.log("Starting GitHub MCP Server...")

		const server = new McpServer({
			name: "GitHub MCP Server",
			version: "2.0.0",
		})

		const octokit = new Octokit({ auth: config.githubPersonalAccessToken })

		registerAllToolsAndResources(server, octokit)

		return server.server
	} catch (e) {
		console.error(e)
		throw e
	}
}
