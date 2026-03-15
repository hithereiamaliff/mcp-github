import { z } from "zod"
import type { Octokit } from "octokit"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"

const CODE_SEARCH_QUALIFIERS = new Set([
	"repo",
	"org",
	"user",
	"language",
	"path",
	"extension",
	"filename",
	"in",
	"size",
	"fork",
])

function splitSearchQuery(query: string): string[] {
	const tokens: string[] = []
	let current = ""
	let inQuotes = false

	for (const char of query) {
		if (char === "\"") {
			inQuotes = !inQuotes
			current += char
			continue
		}

		if (/\s/.test(char) && !inQuotes) {
			if (current) tokens.push(current)
			current = ""
			continue
		}

		current += char
	}

	if (current) tokens.push(current)

	return tokens
}

function isCodeSearchQualifier(token: string): boolean {
	const separatorIndex = token.indexOf(":")
	if (separatorIndex <= 0) return false

	return CODE_SEARCH_QUALIFIERS.has(token.slice(0, separatorIndex).toLowerCase())
}

export function registerSearchTools(server: McpServer, octokit: Octokit) {
	// Tool: Search Repositories
	server.tool(
		"search_repositories",
		"Search for GitHub repositories. Returns a concise list with essential information. Use 'get_repository' for detailed information about a specific repository.",
		{
			query: z
				.string()
				.describe(
					"Search query. Examples: 'language:typescript stars:>1000', 'org:facebook react', 'machine learning in:description', 'user:octocat', 'created:>2023-01-01', 'license:mit', 'topic:javascript', 'is:public archived:false'",
				),
			per_page: z
				.number()
				.optional()
				.default(10)
				.describe("Results per page (default 10, max 100)"),
			page: z
				.number()
				.optional()
				.default(1)
				.describe("Page number (default 1)"),
		},
		async ({ query, per_page, page }) => {
			try {
				const response = await octokit.rest.search.repos({
					q: query,
					per_page,
					page,
				})

				// Extract only essential information
				const repositories = response.data.items.map(repo => ({
					full_name: repo.full_name,
					description:
						repo.description?.slice(0, 150) +
						(repo.description && repo.description.length > 150 ? "..." : ""),
					stars: repo.stargazers_count,
					language: repo.language,
					// Only include updated_at if it's recent (within last year)
					...(new Date(repo.updated_at).getTime() >
					Date.now() - 365 * 24 * 60 * 60 * 1000
						? { updated: new Date(repo.updated_at).toISOString().split("T")[0] }
						: {}),
				}))

				// Format as simple text
				const text = repositories
					.map(
						(repo, i) =>
							`${i + 1}. **${repo.full_name}**${repo.stars ? ` - ${repo.stars.toLocaleString()} stars` : ""}${repo.language ? ` - \`${repo.language}\`` : ""}
   ${repo.description || "_No description_"}${repo.updated ? `\n   _Updated: ${repo.updated}_` : ""}`,
					)
					.join("\n\n")

				return {
					content: [
						{
							type: "text",
							text: text
								? `### Found ${repositories.length} repositories:\n\n${text}`
								: "No repositories found",
						},
					],
				}
			} catch (e: any) {
				return {
					content: [{ type: "text", text: `Error: ${e.message}` }],
				}
			}
		},
	)

	// Tool: Search Code
	server.tool(
		"search_code",
		"Search for code across GitHub repositories. Returns a concise list with file paths and repositories. Use 'get_file_contents' for full file content.",
		{
			q: z
				.string()
				.describe(
					"Search query using GitHub code search syntax. Examples: 'addClass in:file language:js', 'repo:owner/name path:src/ extension:py', 'org:github extension:js', 'filename:test.py', 'user:octocat extension:rb', 'console.log path:/src/components', 'TODO in:file path:src/'",
				),
			sort: z
				.enum(["indexed"])
				.optional()
				.describe("Sort field ('indexed' only)"),
			order: z.enum(["asc", "desc"]).optional().describe("Sort order"),
			per_page: z
				.number()
				.optional()
				.default(10)
				.describe("Results per page (default 10, max 100)"),
			page: z
				.number()
				.optional()
				.default(1)
				.describe("Page number (default 1)"),
		},
		async ({ q, sort, order, per_page, page }) => {
			try {
				const tokens = splitSearchQuery(q.trim())
				const hasFilenameQualifier = tokens.some(token => /^filename:/i.test(token))
				const hasSearchTerm = tokens.some(token => {
					const normalized = token.toUpperCase()
					if (normalized === "AND" || normalized === "OR" || normalized === "NOT") {
						return false
					}

					return !isCodeSearchQualifier(token)
				})

				// GitHub code search requires at least one search term, unless the query is a filename-only search.
				if (!hasSearchTerm && !hasFilenameQualifier) {
					return {
						content: [{
							type: "text",
							text: `GitHub code search needs at least one search term unless you are doing a filename-only search. Your query \`${q}\` only contains qualifiers.\n\nExamples:\n- \`handleClick repo:owner/name\`\n- \`addClass language:javascript\`\n- \`TODO path:src/\`\n- \`filename:test.py\`\n\nPlease retry with a search term, or use \`filename:\` for a filename-only search.`,
						}],
					}
				}

				const response = await octokit.rest.search.code({
					q,
					sort,
					order,
					per_page,
					page,
					mediaType: {
						format: "text-match",
					},
				})

				const totalCount = response.data.total_count

				// Extract only essential information including text matches
				const results = response.data.items.map(item => ({
					repository: item.repository.full_name,
					path: item.path,
					url: item.html_url,
					// Only include the first match fragment for conciseness
					match: item.text_matches?.[0]?.fragment?.slice(0, 200) || null,
				}))

				if (results.length === 0) {
					return {
						content: [{
							type: "text",
							text: `No code results found for query: \`${q}\`\n\nTips:\n- GitHub only indexes the default branch\n- GitHub only indexes files under 384 KB in repositories with recent activity\n- Try adding or broadening qualifiers like \`repo:\`, \`org:\`, \`language:\`, or \`path:\`\n- Ensure the search term is specific enough to be indexed`,
						}],
					}
				}

				// Format as simple text
				const text = results
					.map(
						(item, i) =>
							`${i + 1}. **${item.repository}** / \`${item.path}\`${item.match ? `\n   \`\`\`\n   ${item.match.replace(/\n/g, " ").trim()}\n   \`\`\`` : ""}`,
					)
					.join("\n\n")

				return {
					content: [
						{
							type: "text",
							text: `### Found ${totalCount} total code result(s), showing ${results.length}:\n\n${text}`,
						},
					],
				}
			} catch (e: any) {
				const responseMessage =
					e.response?.data?.message ||
					e.response?.data?.error ||
					e.message ||
					String(e)
				const errorDetails = Array.isArray(e.response?.data?.errors)
					? e.response.data.errors
							.map((error: any) => error.message || error.code || JSON.stringify(error))
							.filter(Boolean)
					: []

				if (e.status === 401) {
					return {
						content: [{
							type: "text",
							text: "GitHub code search requires an authenticated GitHub token. Please retry with a valid token that can access the repositories you want to search.",
						}],
					}
				}

				if (e.status === 422) {
					const detailText = errorDetails.length > 0 ? `\n\nDetails:\n- ${errorDetails.join("\n- ")}` : ""
					return {
						content: [{
							type: "text",
							text: `GitHub rejected the search query: ${responseMessage}${detailText}\n\nTry one of these fixes:\n- include at least one search term unless you are using \`filename:\`\n- verify the qualifier syntax for code search\n- if you used \`repo:\`, \`org:\`, or \`user:\`, confirm the token can access those resources`,
						}],
					}
				}

				return {
					content: [{ type: "text", text: `Error: ${responseMessage}` }],
				}
			}
		},
	)

	// Tool: Search Users
	server.tool(
		"search_users",
		"Search for GitHub users.",
		{
			q: z
				.string()
				.describe(
					"Search query using GitHub users search syntax. Examples: 'location:\"San Francisco\" followers:>100', 'language:python repos:>50', 'fullname:\"John Doe\"', 'type:user', 'type:org', 'created:>2020-01-01', 'in:email example.com'",
				),
			sort: z
				.enum(["followers", "repositories", "joined"])
				.optional()
				.describe("Sort field by category"),
			order: z.enum(["asc", "desc"]).optional().describe("Sort order"),
			per_page: z
				.number()
				.optional()
				.default(10)
				.describe("Results per page (default 10, max 100)"),
			page: z
				.number()
				.optional()
				.default(1)
				.describe("Page number (default 1)"),
		},
		async ({ q, sort, order, per_page, page }) => {
			try {
				const response = await octokit.rest.search.users({
					q,
					sort,
					order,
					per_page,
					page,
				})

				// Extract only essential information
				const users = response.data.items.map(user => ({
					login: user.login,
					type: user.type,
					// Only include name if it exists and is different from login
					...(user.name && user.name !== user.login ? { name: user.name } : {}),
					// Include bio if it exists (truncated)
					...(user.bio
						? {
								bio:
									user.bio.slice(0, 100) + (user.bio.length > 100 ? "..." : ""),
							}
						: {}),
					// Include location if it exists
					...(user.location ? { location: user.location } : {}),
					// Include company if it exists
					...(user.company ? { company: user.company } : {}),
					// Include public repos if > 0
					...(user.public_repos && user.public_repos > 0
						? { repos: user.public_repos }
						: {}),
					// Only include followers if > 0
					...(user.followers && user.followers > 0
						? { followers: user.followers }
						: {}),
				}))

				// Format as simple text
				const text = users
					.map((user, i) => {
						let line = `${i + 1}. **${user.login}**${user.name ? ` (${user.name})` : ""}${user.type === "Organization" ? " `[org]`" : ""}`
						const details = []
						if (user.followers)
							details.push(`${user.followers.toLocaleString()} followers`)
						if (user.repos) details.push(`${user.repos} repos`)
						if (user.location) details.push(user.location)
						if (user.company) details.push(user.company)
						if (details.length > 0) line += `\n   ${details.join(" • ")}`
						if (user.bio) line += `\n   > ${user.bio}`
						return line
					})
					.join("\n\n")

				return {
					content: [
						{
							type: "text",
							text: text
								? `### Found ${users.length} users:\n\n${text}`
								: "No users found",
						},
					],
				}
			} catch (e: any) {
				return {
					content: [{ type: "text", text: `Error: ${e.message}` }],
				}
			}
		},
	)
}
