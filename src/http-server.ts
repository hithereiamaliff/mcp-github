/**
 * GitHub MCP Server - Streamable HTTP Transport
 *
 * Production-ready HTTP server for self-hosting on VPS.
 * Supports multiple auth modes: self-hosted, hosted key-service, Smithery.
 * Per-request McpServer/Transport isolation following mcpvps-deploymentguide patterns.
 *
 * Usage:
 *   npm run build:tsc
 *   node dist/http-server.js
 */

import express, { Request, Response } from 'express';
import cors from 'cors';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Octokit } from 'octokit';
import { registerAllToolsAndResources } from './index.js';

// =============================================================================
// Configuration
// =============================================================================

const PORT = parseInt(process.env.PORT || '8080', 10);
const HOST = process.env.HOST || '0.0.0.0';
const MCP_API_KEY = process.env.MCP_API_KEY || '';
const MCP_PROTOCOL_VERSION = process.env.MCP_PROTOCOL_VERSION || '2025-11-25';
const ENABLE_MCP_DIAGNOSTICS = process.env.ENABLE_MCP_DIAGNOSTICS === 'true';
const ENABLE_SMITHERY_ENDPOINT = process.env.ENABLE_SMITHERY_ENDPOINT === 'true';
const MCP_TRACE_HTTP = process.env.MCP_TRACE_HTTP === 'true';
const KEY_SERVICE_URL = process.env.KEY_SERVICE_URL || '';
const KEY_SERVICE_TOKEN = process.env.KEY_SERVICE_TOKEN || '';
const ANALYTICS_DIR = process.env.ANALYTICS_DIR || '/app/data';
const ANALYTICS_FILE = path.join(ANALYTICS_DIR, 'analytics.json');
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '*')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);
const ALLOW_ALL_ORIGINS = ALLOWED_ORIGINS.length === 0 || ALLOWED_ORIGINS.includes('*');

type AuthMode = 'hosted-key-service' | 'self-hosted' | 'smithery' | 'diagnostics' | 'legacy-query';

if (!MCP_API_KEY) {
  console.warn('MCP_API_KEY is not set. Self-hosted /mcp and /analytics access will be disabled.');
}

if ((KEY_SERVICE_URL && !KEY_SERVICE_TOKEN) || (!KEY_SERVICE_URL && KEY_SERVICE_TOKEN)) {
  console.warn('Hosted key-service mode requires both KEY_SERVICE_URL and KEY_SERVICE_TOKEN.');
}

// =============================================================================
// Error handling
// =============================================================================

class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

// =============================================================================
// Utility functions
// =============================================================================

function maskValue(value?: string): string | undefined {
  if (!value) return undefined;
  if (value.length <= 8) return '***';
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function hashIp(ip: string): string {
  return crypto.createHash('sha256').update(ip).digest('hex').slice(0, 12);
}

function getClientIp(req: Request): string {
  return (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
    req.socket.remoteAddress ||
    'unknown';
}

function normalizeRouteForAnalytics(req: Request): string {
  if (req.path.startsWith('/mcp/usr_')) return '/mcp/:userKey';
  if (req.path === '/smithery/mcp') return '/smithery/mcp';
  if (req.path === '/mcp-debug/open') return '/mcp-debug/open';
  if (req.path === '/.well-known/mcp/server-card.json') return '/.well-known/mcp/server-card.json';
  if (req.path === '/mcp') return '/mcp';
  return req.path;
}

// =============================================================================
// HTTP tracing (env-gated)
// =============================================================================

function traceHttp(req: Request, res: Response, details: Record<string, unknown> = {}): void {
  if (!MCP_TRACE_HTTP) return;

  console.log('[mcp-http]', {
    method: req.method,
    path: normalizeRouteForAnalytics(req),
    accept: req.get('accept'),
    contentType: req.get('content-type'),
    protocolVersion: req.get('mcp-protocol-version'),
    status: res.statusCode,
    ...details,
  });
}

function getHostedUserKeyFromQuery(req: Request): string | undefined {
  const candidate = req.query.api_key ?? req.query.apiKey;
  return typeof candidate === 'string' && candidate.startsWith('usr_')
    ? candidate
    : undefined;
}

// =============================================================================
// Analytics
// =============================================================================

interface Analytics {
  serverStartTime: string;
  totalRequests: number;
  totalToolCalls: number;
  requestsByMethod: Record<string, number>;
  requestsByEndpoint: Record<string, number>;
  toolCalls: Record<string, number>;
  recentToolCalls: Array<{ tool: string; timestamp: string }>;
  clientsByIp: Record<string, number>;
  clientsByUserAgent: Record<string, number>;
  hourlyRequests: Record<string, number>;
}

const defaultAnalytics: Analytics = {
  serverStartTime: new Date().toISOString(),
  totalRequests: 0,
  totalToolCalls: 0,
  requestsByMethod: {},
  requestsByEndpoint: {},
  toolCalls: {},
  recentToolCalls: [],
  clientsByIp: {},
  clientsByUserAgent: {},
  hourlyRequests: {},
};

function loadAnalytics(): Analytics {
  try {
    if (fs.existsSync(ANALYTICS_FILE)) {
      const data = fs.readFileSync(ANALYTICS_FILE, 'utf-8');
      const loaded = JSON.parse(data);
      // Always provide fallback defaults for all fields (Firebase/load safety)
      return {
        serverStartTime: loaded.serverStartTime || new Date().toISOString(),
        totalRequests: loaded.totalRequests || 0,
        totalToolCalls: loaded.totalToolCalls || 0,
        requestsByMethod: loaded.requestsByMethod || {},
        requestsByEndpoint: loaded.requestsByEndpoint || {},
        toolCalls: loaded.toolCalls || {},
        recentToolCalls: loaded.recentToolCalls || [],
        clientsByIp: loaded.clientsByIp || {},
        clientsByUserAgent: loaded.clientsByUserAgent || {},
        hourlyRequests: loaded.hourlyRequests || {},
      };
    }
  } catch (error) {
    console.warn('Could not load analytics file, starting fresh:', error);
  }
  return { ...defaultAnalytics };
}

function saveAnalytics(): void {
  try {
    if (!fs.existsSync(ANALYTICS_DIR)) {
      fs.mkdirSync(ANALYTICS_DIR, { recursive: true });
    }
    fs.writeFileSync(ANALYTICS_FILE, JSON.stringify(analytics, null, 2));
  } catch (error) {
    console.warn('Could not save analytics file:', error);
  }
}

const analytics: Analytics = loadAnalytics();

// Auto-save every 5 minutes
setInterval(saveAnalytics, 5 * 60 * 1000);

// Save on shutdown
process.on('SIGTERM', () => {
  console.log('Saving analytics before shutdown...');
  saveAnalytics();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('Saving analytics before shutdown...');
  saveAnalytics();
  process.exit(0);
});

function trackRequest(req: Request, endpoint: string): void {
  analytics.totalRequests++;

  const method = req.method;
  analytics.requestsByMethod[method] = (analytics.requestsByMethod[method] || 0) + 1;

  analytics.requestsByEndpoint[endpoint] = (analytics.requestsByEndpoint[endpoint] || 0) + 1;

  // Hash IP for privacy
  const hashedIp = hashIp(getClientIp(req));
  analytics.clientsByIp[hashedIp] = (analytics.clientsByIp[hashedIp] || 0) + 1;

  const userAgent = req.headers['user-agent'] || 'unknown';
  const shortUserAgent = userAgent.split('/')[0] || userAgent.slice(0, 50);
  analytics.clientsByUserAgent[shortUserAgent] = (analytics.clientsByUserAgent[shortUserAgent] || 0) + 1;

  const hourKey = new Date().toISOString().slice(0, 13) + ':00';
  analytics.hourlyRequests[hourKey] = (analytics.hourlyRequests[hourKey] || 0) + 1;
}

function trackToolCall(toolName: string): void {
  analytics.totalToolCalls++;
  analytics.toolCalls[toolName] = (analytics.toolCalls[toolName] || 0) + 1;

  // No raw IP in recent calls — privacy preserving
  analytics.recentToolCalls.unshift({
    tool: toolName,
    timestamp: new Date().toISOString(),
  });
  if (analytics.recentToolCalls.length > 100) {
    analytics.recentToolCalls.pop();
  }
}

function getUptime(): string {
  const start = new Date(analytics.serverStartTime).getTime();
  const diff = Date.now() - start;
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

// =============================================================================
// Analytics endpoint auth middleware
// =============================================================================

function requireApiKey(req: Request, res: Response): boolean {
  if (!MCP_API_KEY) {
    res.status(503).json({
      error: 'server_misconfigured',
      message: 'MCP_API_KEY is required to access analytics on this deployment.',
    });
    return false;
  }

  const providedKey = req.get('X-API-Key');
  if (providedKey === MCP_API_KEY) return true;

  res.status(401).json({ error: 'unauthorized', message: 'Valid X-API-Key header required' });
  return false;
}

// =============================================================================
// Key Service resolution
// =============================================================================

async function resolveUserKeyWithKeyService(userKey: string): Promise<string> {
  if (!KEY_SERVICE_URL || !KEY_SERVICE_TOKEN) {
    throw new HttpError(503, 'service_unavailable', 'Key service not configured');
  }

  let response: globalThis.Response;
  try {
    response = await fetch(KEY_SERVICE_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${KEY_SERVICE_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ key: userKey }),
      signal: AbortSignal.timeout(10000),
    });
  } catch (error) {
    throw new HttpError(503, 'service_unavailable', 'Key service unreachable');
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new HttpError(502, 'malformed_response', `Key service returned non-JSON content type: ${contentType}`);
  }

  if (response.status === 404 || response.status === 403) {
    const body = await response.json().catch(() => ({}));
    throw new HttpError(403, 'invalid_key', body.message || 'Invalid or expired user key');
  }

  if (!response.ok) {
    throw new HttpError(502, 'service_unavailable', `Key service returned status ${response.status}`);
  }

  const data = await response.json();
  const token = data.github_token || data.githubToken || data.token;
  if (!token) {
    throw new HttpError(502, 'malformed_response', 'Key service response missing GitHub token');
  }

  return token;
}

// =============================================================================
// MCP server factory
// =============================================================================

function createAppServer(token: string): McpServer {
  const server = new McpServer(
    { name: 'GitHub MCP Server', version: '2.0.0' },
    { capabilities: { tools: { listChanged: true } } },
  );

  const octokit = new Octokit({ auth: token });
  registerAllToolsAndResources(server, octokit);

  return server;
}

function createDiagnosticsServer(): McpServer {
  const server = new McpServer({
    name: 'GitHub MCP Server (Diagnostics)',
    version: '2.0.0',
  });

  server.tool(
    'diagnostics_ping',
    'Minimal tool to verify transport and initialization',
    {},
    async () => ({
      content: [{ type: 'text', text: 'pong' }],
    }),
  );

  return server;
}

// =============================================================================
// Server card
// =============================================================================

function buildServerCard() {
  return {
    $schema: 'https://static.modelcontextprotocol.io/schemas/mcp-server-card/v1.json',
    version: '1.0',
    protocolVersion: MCP_PROTOCOL_VERSION,
    serverInfo: {
      name: 'GitHub MCP Server',
      version: '2.0.0',
    },
    transport: {
      type: 'streamable-http',
      endpoint: '/mcp',
    },
    authentication: {
      required: true,
    },
    tools: ['dynamic'],
  };
}

// =============================================================================
// Per-request MCP handler
// =============================================================================

async function handleMcpRequest(
  req: Request,
  res: Response,
  authMode: AuthMode,
): Promise<void> {
  // Resolve GitHub token based on auth mode
  let token: string;

  if (authMode === 'diagnostics') {
    // No token needed for diagnostics
    token = '';
  } else if (authMode === 'hosted-key-service') {
    const userKey = req.params.userKey
      ?? req.query.api_key as string
      ?? req.query.apiKey as string;

    if (typeof userKey !== 'string' || !userKey.startsWith('usr_')) {
      throw new HttpError(403, 'invalid_key', 'Missing or invalid hosted user key');
    }

    token = await resolveUserKeyWithKeyService(userKey);
  } else if (authMode === 'smithery') {
    const githubToken = req.get('X-GitHub-Token');
    if (!githubToken) {
      throw new HttpError(400, 'missing_config', 'Missing X-GitHub-Token header for Smithery endpoint');
    }
    token = githubToken;
  } else if (authMode === 'self-hosted') {
    if (!MCP_API_KEY) {
      throw new HttpError(503, 'server_misconfigured', 'MCP_API_KEY is required to use self-hosted /mcp mode.');
    }

    // Check API key first
    const apiKey = req.get('X-API-Key');

    if (apiKey !== MCP_API_KEY) {
      throw new HttpError(403, 'invalid_key', 'Invalid or missing API key');
    }

    // Get GitHub token from header
    const githubToken = req.get('X-GitHub-Token');
    if (githubToken) {
      token = githubToken;
    } else {
      throw new HttpError(400, 'missing_config', 'Missing X-GitHub-Token header');
    }
  } else if (authMode === 'legacy-query') {
    // Legacy ?token= fallback (deprecated)
    const legacyToken = req.query.token;
    if (typeof legacyToken !== 'string' || legacyToken.trim().length === 0) {
      throw new HttpError(401, 'missing_config', 'GitHub token required. Use X-API-Key + X-GitHub-Token headers instead of ?token= (deprecated).');
    }
    token = legacyToken;
    console.warn(`[deprecation] Client using ?token= query param from ${hashIp(getClientIp(req))}. Migrate to X-API-Key + X-GitHub-Token headers.`);
  } else {
    throw new HttpError(500, 'internal_error', 'Unknown auth mode');
  }

  // Track tool calls
  if (req.body?.method === 'tools/call' && req.body?.params?.name) {
    trackToolCall(req.body.params.name);
  }

  // Create per-request server and transport
  const server = authMode === 'diagnostics'
    ? createDiagnosticsServer()
    : createAppServer(token);

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  // Idempotent cleanup — only on res.finish/res.close, not in finally
  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    void transport.close();
    void server.close();
  };

  res.once('finish', cleanup);
  res.once('close', cleanup);

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    traceHttp(req, res, { authMode, maskedKey: authMode === 'hosted-key-service' ? maskValue(req.params.userKey) : undefined });
  } catch (error) {
    cleanup();

    if (error instanceof HttpError) {
      traceHttp(req, res, { authMode, errorCode: error.code });
      if (!res.headersSent) {
        res.status(error.status).json({ error: error.code, message: error.message });
      }
      return;
    }

    console.error('Unhandled MCP HTTP error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'internal_error', message: 'Unexpected server error' });
    }
  }
}

// =============================================================================
// Express app
// =============================================================================

const app = express();

app.set('trust proxy', true);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || ALLOW_ALL_ORIGINS || ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Accept',
    'Authorization',
    'Mcp-Session-Id',
    'Mcp-Protocol-Version',
    'X-API-Key',
    'X-GitHub-Token',
  ],
  exposedHeaders: ['Mcp-Session-Id'],
}));

app.use(express.json({ limit: '1mb' }));

// Track non-analytics requests
app.use((req: Request, _res: Response, next) => {
  if (!req.path.startsWith('/analytics')) {
    trackRequest(req, normalizeRouteForAnalytics(req));
  }
  next();
});

// =============================================================================
// Health check
// =============================================================================

app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    server: 'GitHub MCP Server',
    version: '2.0.0',
    transport: 'streamable-http',
    protocolVersion: MCP_PROTOCOL_VERSION,
    timestamp: new Date().toISOString(),
  });
});

// =============================================================================
// Server card (static discovery)
// =============================================================================

app.get('/.well-known/mcp/server-card.json', (_req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.json(buildServerCard());
});

// OAuth metadata — deliberate 404s (this server does not implement OAuth)
app.all('/.well-known/oauth-protected-resource/:path(*)', (_req: Request, res: Response) => {
  res.status(404).json({ error: 'oauth_metadata_not_supported' });
});

app.all('/.well-known/oauth-authorization-server/:path(*)', (_req: Request, res: Response) => {
  res.status(404).json({ error: 'oauth_metadata_not_supported' });
});

// =============================================================================
// Root endpoint
// =============================================================================

app.get('/', (_req: Request, res: Response) => {
  res.json({
    name: 'GitHub MCP Server',
    version: '2.0.0',
    description: 'MCP server for interacting with GitHub',
    transport: 'streamable-http',
    protocolVersion: MCP_PROTOCOL_VERSION,
    endpoints: {
      mcp: '/mcp',
      health: '/health',
      discovery: '/.well-known/mcp/server-card.json',
      analytics: '/analytics',
      analyticsDashboard: '/analytics/dashboard',
    },
    documentation: 'https://github.com/hithereiamaliff/mcp-github',
  });
});

// =============================================================================
// Analytics endpoints (protected by API key)
// =============================================================================

app.get('/analytics', (req: Request, res: Response) => {
  if (!requireApiKey(req, res)) return;

  const sortedTools = Object.entries(analytics.toolCalls)
    .sort(([, a], [, b]) => b - a)
    .reduce((acc, [k, v]) => ({ ...acc, [k]: v }), {} as Record<string, number>);

  const sortedClients = Object.entries(analytics.clientsByIp)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 20)
    .reduce((acc, [k, v]) => ({ ...acc, [k]: v }), {} as Record<string, number>);

  const last24Hours = Object.entries(analytics.hourlyRequests)
    .sort(([a], [b]) => b.localeCompare(a))
    .slice(0, 24)
    .reverse()
    .reduce((acc, [k, v]) => ({ ...acc, [k]: v }), {} as Record<string, number>);

  res.json({
    server: 'GitHub MCP Server',
    uptime: getUptime(),
    serverStartTime: analytics.serverStartTime,
    summary: {
      totalRequests: analytics.totalRequests,
      totalToolCalls: analytics.totalToolCalls,
      uniqueClients: Object.keys(analytics.clientsByIp).length,
    },
    breakdown: {
      byMethod: analytics.requestsByMethod,
      byEndpoint: analytics.requestsByEndpoint,
      byTool: sortedTools,
    },
    clients: {
      byIp: sortedClients,
      byUserAgent: analytics.clientsByUserAgent,
    },
    hourlyRequests: last24Hours,
    recentToolCalls: analytics.recentToolCalls.slice(0, 20),
  });
});

app.get('/analytics/tools', (req: Request, res: Response) => {
  if (!requireApiKey(req, res)) return;

  const sortedTools = Object.entries(analytics.toolCalls)
    .sort(([, a], [, b]) => b - a)
    .map(([tool, count]) => ({
      tool,
      count,
      percentage: analytics.totalToolCalls > 0
        ? ((count / analytics.totalToolCalls) * 100).toFixed(1) + '%'
        : '0%',
    }));

  res.json({
    totalToolCalls: analytics.totalToolCalls,
    tools: sortedTools,
    recentCalls: analytics.recentToolCalls,
  });
});

// Analytics dashboard — HTML shell loads publicly, data requires API key
app.get('/analytics/dashboard', (_req: Request, res: Response) => {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GitHub MCP - Analytics Dashboard</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #0d1117 0%, #161b22 100%);
      min-height: 100vh;
      color: #e6edf3;
      padding: 20px;
    }
    .container { max-width: 1400px; margin: 0 auto; }
    header {
      text-align: center;
      margin-bottom: 30px;
      padding: 20px;
      background: rgba(255,255,255,0.05);
      border-radius: 16px;
      backdrop-filter: blur(10px);
    }
    header h1 {
      font-size: 2rem;
      background: linear-gradient(90deg, #58a6ff, #a371f7);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      margin-bottom: 8px;
    }
    header p { color: #8b949e; }
    .auth-card {
      max-width: 400px;
      margin: 60px auto;
      padding: 32px;
      background: rgba(255,255,255,0.05);
      border-radius: 16px;
      border: 1px solid rgba(255,255,255,0.1);
      text-align: center;
    }
    .auth-card h2 { margin-bottom: 16px; font-size: 1.25rem; }
    .auth-card input {
      width: 100%;
      padding: 12px;
      border-radius: 8px;
      border: 1px solid rgba(255,255,255,0.2);
      background: rgba(0,0,0,0.3);
      color: #e6edf3;
      font-size: 1rem;
      margin-bottom: 12px;
    }
    .auth-card button {
      width: 100%;
      padding: 12px;
      border-radius: 8px;
      border: none;
      background: #58a6ff;
      color: #0d1117;
      font-weight: 600;
      cursor: pointer;
      font-size: 1rem;
    }
    .auth-card button:hover { background: #79c0ff; }
    .auth-error { color: #f85149; margin-top: 8px; font-size: 0.875rem; }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 20px;
      margin-bottom: 30px;
    }
    .stat-card {
      background: rgba(255,255,255,0.05);
      border-radius: 12px;
      padding: 24px;
      text-align: center;
      border: 1px solid rgba(255,255,255,0.1);
      transition: transform 0.2s;
    }
    .stat-card:hover { transform: translateY(-2px); }
    .stat-card h3 { color: #8b949e; font-size: 0.875rem; margin-bottom: 8px; }
    .stat-card .value { font-size: 2rem; font-weight: bold; color: #58a6ff; }
    .charts-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
      gap: 20px;
      margin-bottom: 30px;
    }
    .chart-card {
      background: rgba(255,255,255,0.05);
      border-radius: 12px;
      padding: 20px;
      border: 1px solid rgba(255,255,255,0.1);
    }
    .chart-card h3 { margin-bottom: 16px; color: #e6edf3; }
    .recent-calls {
      background: rgba(255,255,255,0.05);
      border-radius: 12px;
      padding: 20px;
      border: 1px solid rgba(255,255,255,0.1);
    }
    .recent-calls h3 { margin-bottom: 16px; }
    .call-item {
      display: flex;
      justify-content: space-between;
      padding: 12px;
      border-bottom: 1px solid rgba(255,255,255,0.05);
    }
    .call-item:last-child { border-bottom: none; }
    .call-tool { color: #58a6ff; font-weight: 500; }
    .call-time { color: #8b949e; font-size: 0.875rem; }
    .refresh-note { text-align: center; color: #8b949e; margin-top: 20px; font-size: 0.875rem; }
    #dashboard { display: none; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>GitHub MCP Analytics</h1>
      <p>Real-time usage statistics</p>
    </header>

    <div id="authSection">
      <div class="auth-card">
        <h2>API Key Required</h2>
        <p style="color:#8b949e;margin-bottom:16px;">Enter your MCP API key to view analytics.</p>
        <input type="password" id="apiKeyInput" placeholder="Enter API key..." />
        <button onclick="authenticate()">View Dashboard</button>
        <p class="auth-error" id="authError" style="display:none;"></p>
      </div>
    </div>

    <div id="dashboard">
      <div class="stats-grid" id="stats"></div>
      <div class="charts-grid">
        <div class="chart-card">
          <h3>Tool Usage Distribution</h3>
          <canvas id="toolChart"></canvas>
        </div>
        <div class="chart-card">
          <h3>Hourly Requests (Last 24h)</h3>
          <canvas id="hourlyChart"></canvas>
        </div>
        <div class="chart-card">
          <h3>Clients by User Agent</h3>
          <canvas id="clientChart"></canvas>
        </div>
        <div class="chart-card">
          <h3>Requests by Endpoint</h3>
          <canvas id="endpointChart"></canvas>
        </div>
      </div>
      <div class="recent-calls">
        <h3>Recent Tool Calls</h3>
        <div id="recentCalls"></div>
      </div>
      <p class="refresh-note">Auto-refreshes every 30 seconds</p>
    </div>
  </div>

  <script>
    let toolChart, hourlyChart, clientChart, endpointChart;
    let refreshInterval;

    function getApiKey() {
      return sessionStorage.getItem('mcp_api_key') || '';
    }

    async function authenticate() {
      const key = document.getElementById('apiKeyInput').value.trim();
      if (!key) return;
      sessionStorage.setItem('mcp_api_key', key);
      const ok = await tryLoadData();
      if (ok) {
        document.getElementById('authSection').style.display = 'none';
        document.getElementById('dashboard').style.display = 'block';
        refreshInterval = setInterval(refresh, 30000);
      } else {
        sessionStorage.removeItem('mcp_api_key');
        const err = document.getElementById('authError');
        err.textContent = 'Invalid API key. Please try again.';
        err.style.display = 'block';
      }
    }

    // Auto-login if key is in session
    (async function init() {
      const key = getApiKey();
      if (key) {
        const ok = await tryLoadData();
        if (ok) {
          document.getElementById('authSection').style.display = 'none';
          document.getElementById('dashboard').style.display = 'block';
          refreshInterval = setInterval(refresh, 30000);
        } else {
          sessionStorage.removeItem('mcp_api_key');
        }
      }
    })();

    async function tryLoadData() {
      try {
        const data = await fetchData();
        if (!data || data.error) return false;
        updateStats(data);
        updateCharts(data);
        updateRecentCalls(data);
        return true;
      } catch { return false; }
    }

    async function fetchData() {
      const basePath = window.location.pathname.replace(/\\/analytics\\/dashboard\\/?$/, '');
      const res = await fetch(basePath + '/analytics', {
        headers: { 'X-API-Key': getApiKey() }
      });
      if (!res.ok) throw new Error('Unauthorized');
      return res.json();
    }

    function updateStats(data) {
      document.getElementById('stats').innerHTML =
        '<div class="stat-card"><h3>Total Requests</h3><div class="value">' + data.summary.totalRequests.toLocaleString() + '</div></div>' +
        '<div class="stat-card"><h3>Tool Calls</h3><div class="value">' + data.summary.totalToolCalls.toLocaleString() + '</div></div>' +
        '<div class="stat-card"><h3>Unique Clients</h3><div class="value">' + data.summary.uniqueClients.toLocaleString() + '</div></div>' +
        '<div class="stat-card"><h3>Uptime</h3><div class="value">' + data.uptime + '</div></div>';
    }

    function updateCharts(data) {
      const colors = ['#58a6ff', '#a371f7', '#3fb950', '#f0883e', '#f85149', '#8b949e', '#6e7681', '#484f58', '#30363d', '#21262d'];
      const chartOpts = { responsive: true, maintainAspectRatio: false };

      // Tool chart
      const toolLabels = Object.keys(data.breakdown.byTool).slice(0, 10);
      const toolValues = Object.values(data.breakdown.byTool).slice(0, 10);
      if (toolChart) toolChart.destroy();
      toolChart = new Chart(document.getElementById('toolChart'), {
        type: 'doughnut',
        data: { labels: toolLabels, datasets: [{ data: toolValues, backgroundColor: colors }] },
        options: { plugins: { legend: { position: 'right', labels: { color: '#e6edf3' } } } }
      });

      // Hourly chart
      const hourlyLabels = Object.keys(data.hourlyRequests).map(function(h) { return h.slice(11, 16); });
      const hourlyValues = Object.values(data.hourlyRequests);
      if (hourlyChart) hourlyChart.destroy();
      hourlyChart = new Chart(document.getElementById('hourlyChart'), {
        type: 'bar',
        data: { labels: hourlyLabels, datasets: [{ label: 'Requests', data: hourlyValues, backgroundColor: '#58a6ff' }] },
        options: { scales: { y: { beginAtZero: true, ticks: { color: '#8b949e' }, grid: { color: 'rgba(255,255,255,0.1)' } }, x: { ticks: { color: '#8b949e' }, grid: { color: 'rgba(255,255,255,0.1)' } } }, plugins: { legend: { display: false } } }
      });

      // Client chart
      var clientLabels = Object.keys(data.clients.byUserAgent).slice(0, 8);
      var clientValues = Object.values(data.clients.byUserAgent).slice(0, 8);
      if (clientChart) clientChart.destroy();
      clientChart = new Chart(document.getElementById('clientChart'), {
        type: 'bar',
        data: { labels: clientLabels, datasets: [{ label: 'Requests', data: clientValues, backgroundColor: colors.slice(0, 8) }] },
        options: { indexAxis: 'y', scales: { x: { beginAtZero: true, ticks: { color: '#8b949e' }, grid: { color: 'rgba(255,255,255,0.1)' } }, y: { ticks: { color: '#8b949e' }, grid: { display: false } } }, plugins: { legend: { display: false } } }
      });

      // Endpoint chart
      var epLabels = Object.keys(data.breakdown.byEndpoint).slice(0, 10);
      var epValues = Object.values(data.breakdown.byEndpoint).slice(0, 10);
      if (endpointChart) endpointChart.destroy();
      endpointChart = new Chart(document.getElementById('endpointChart'), {
        type: 'bar',
        data: { labels: epLabels, datasets: [{ data: epValues, backgroundColor: colors, borderRadius: 8 }] },
        options: { scales: { x: { ticks: { color: '#8b949e' }, grid: { display: false } }, y: { beginAtZero: true, ticks: { color: '#8b949e' }, grid: { color: 'rgba(255,255,255,0.05)' } } }, plugins: { legend: { display: false } } }
      });
    }

    function updateRecentCalls(data) {
      var calls = data.recentToolCalls.slice(0, 10);
      document.getElementById('recentCalls').innerHTML = calls.map(function(call) {
        return '<div class="call-item"><span class="call-tool">' + call.tool + '</span><span class="call-time">' + new Date(call.timestamp).toLocaleTimeString() + '</span></div>';
      }).join('') || '<p style="color:#8b949e;text-align:center;padding:20px;">No recent calls</p>';
    }

    async function refresh() {
      try { await tryLoadData(); } catch {}
    }

    // Allow Enter key in the API key input
    document.getElementById('apiKeyInput').addEventListener('keypress', function(e) {
      if (e.key === 'Enter') authenticate();
    });
  </script>
</body>
</html>`;

  res.type('html').send(html);
});

// =============================================================================
// Diagnostics endpoint (env-gated)
// =============================================================================

if (ENABLE_MCP_DIAGNOSTICS) {
  app.all('/mcp-debug/open', async (req: Request, res: Response) => {
    try {
      await handleMcpRequest(req, res, 'diagnostics');
    } catch (error) {
      if (error instanceof HttpError && !res.headersSent) {
        res.status(error.status).json({ error: error.code, message: error.message });
      } else if (!res.headersSent) {
        res.status(500).json({ error: 'internal_error', message: 'Unexpected error' });
      }
    }
  });
}

// =============================================================================
// MCP endpoints — per-request isolation
// =============================================================================

// Hosted key-service mode: /mcp/:userKey
app.all('/mcp/:userKey', async (req: Request, res: Response) => {
  try {
    await handleMcpRequest(req, res, 'hosted-key-service');
  } catch (error) {
    if (error instanceof HttpError && !res.headersSent) {
      res.status(error.status).json({ error: error.code, message: error.message });
    } else if (!res.headersSent) {
      res.status(500).json({ error: 'internal_error', message: 'Unexpected error' });
    }
  }
});

// Self-hosted mode: /mcp (header auth)
// Also handles legacy ?token= fallback
app.all('/mcp', async (req: Request, res: Response) => {
  try {
    const hasSelfHostedHeaders = Boolean(req.get('X-API-Key') || req.get('X-GitHub-Token'));
    const hostedUserKey = getHostedUserKeyFromQuery(req);
    const hasLegacyToken = typeof req.query.token === 'string' && req.query.token.trim().length > 0;

    let authMode: AuthMode;
    if (hasSelfHostedHeaders) {
      authMode = 'self-hosted';
    } else if (hostedUserKey) {
      authMode = 'hosted-key-service';
    } else if (hasLegacyToken) {
      authMode = 'legacy-query';
    } else {
      throw new HttpError(
        401,
        'missing_auth',
        'Provide X-API-Key + X-GitHub-Token headers, ?api_key=usr_... for hosted key-service mode, or ?token=... (deprecated).',
      );
    }

    await handleMcpRequest(req, res, authMode);
  } catch (error) {
    if (error instanceof HttpError && !res.headersSent) {
      res.status(error.status).json({ error: error.code, message: error.message });
    } else if (!res.headersSent) {
      res.status(500).json({ error: 'internal_error', message: 'Unexpected error' });
    }
  }
});

// Smithery mode: /smithery/mcp (env-gated)
if (ENABLE_SMITHERY_ENDPOINT) {
  app.all('/smithery/mcp', async (req: Request, res: Response) => {
    try {
      await handleMcpRequest(req, res, 'smithery');
    } catch (error) {
      if (error instanceof HttpError && !res.headersSent) {
        res.status(error.status).json({ error: error.code, message: error.message });
      } else if (!res.headersSent) {
        res.status(500).json({ error: 'internal_error', message: 'Unexpected error' });
      }
    }
  });
}

// =============================================================================
// Start server
// =============================================================================

app.listen(PORT, HOST, () => {
  console.log('='.repeat(60));
  console.log('GitHub MCP Server (Streamable HTTP) v2.0.0');
  console.log('='.repeat(60));
  console.log(`Server: http://${HOST}:${PORT}`);
  console.log(`MCP endpoint: /mcp (self-hosted), /mcp/:userKey (hosted)`);
  console.log(`Health: /health`);
  console.log(`Discovery: /.well-known/mcp/server-card.json`);
  console.log(`Analytics: /analytics/dashboard`);
  console.log(`Diagnostics: ${ENABLE_MCP_DIAGNOSTICS ? '/mcp-debug/open (enabled)' : 'disabled'}`);
  console.log(`Smithery: ${ENABLE_SMITHERY_ENDPOINT ? '/smithery/mcp (enabled)' : 'disabled'}`);
  console.log(`HTTP tracing: ${MCP_TRACE_HTTP ? 'enabled' : 'disabled'}`);
  console.log(`Self-hosted auth: ${MCP_API_KEY ? 'enabled' : 'disabled (set MCP_API_KEY to enable /mcp and /analytics)'}`);
  console.log(`Key service: ${KEY_SERVICE_URL ? 'configured' : 'not configured'}`);
  console.log(`CORS origins: ${ALLOW_ALL_ORIGINS ? '*' : ALLOWED_ORIGINS.join(', ')}`);
  console.log('='.repeat(60));
});
