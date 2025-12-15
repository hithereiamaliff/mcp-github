/**
 * GitHub MCP Server - Streamable HTTP Transport
 * 
 * This file provides an HTTP server for self-hosting the MCP server on a VPS.
 * It uses the Streamable HTTP transport for MCP communication.
 * 
 * Usage:
 *   npm run build
 *   node dist/http-server.js
 * 
 * Or with environment variables:
 *   PORT=8080 GITHUB_PERSONAL_ACCESS_TOKEN=your_token node dist/http-server.js
 */

import express, { Request, Response } from 'express';
import cors from 'cors';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Octokit } from 'octokit';
import { registerIssueTools } from './tools/issues.js';
import { registerPullRequestTools } from './tools/pullrequests.js';
import { registerRepositoryTools } from './tools/repositories.js';
import { registerSearchTools } from './tools/search.js';

// Configuration
const PORT = parseInt(process.env.PORT || '8080', 10);
const HOST = process.env.HOST || '0.0.0.0';
const GITHUB_TOKEN = process.env.GITHUB_PERSONAL_ACCESS_TOKEN || '';

// Analytics tracking
interface Analytics {
  serverStartTime: string;
  totalRequests: number;
  totalToolCalls: number;
  requestsByMethod: Record<string, number>;
  requestsByEndpoint: Record<string, number>;
  toolCalls: Record<string, number>;
  recentToolCalls: Array<{ tool: string; timestamp: string; clientIp: string }>;
  clientsByIp: Record<string, number>;
  clientsByUserAgent: Record<string, number>;
  hourlyRequests: Record<string, number>;
}

const analytics: Analytics = {
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

function getClientIp(req: Request): string {
  return (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || 
         req.socket.remoteAddress || 
         'unknown';
}

function trackRequest(req: Request, endpoint: string): void {
  analytics.totalRequests++;
  
  // Track by method
  const method = req.method;
  analytics.requestsByMethod[method] = (analytics.requestsByMethod[method] || 0) + 1;
  
  // Track by endpoint
  analytics.requestsByEndpoint[endpoint] = (analytics.requestsByEndpoint[endpoint] || 0) + 1;
  
  // Track by client IP
  const clientIp = getClientIp(req);
  analytics.clientsByIp[clientIp] = (analytics.clientsByIp[clientIp] || 0) + 1;
  
  // Track by user agent
  const userAgent = req.headers['user-agent'] || 'unknown';
  const shortUserAgent = userAgent.split('/')[0] || userAgent.slice(0, 50);
  analytics.clientsByUserAgent[shortUserAgent] = (analytics.clientsByUserAgent[shortUserAgent] || 0) + 1;
  
  // Track hourly
  const hourKey = new Date().toISOString().slice(0, 13) + ':00';
  analytics.hourlyRequests[hourKey] = (analytics.hourlyRequests[hourKey] || 0) + 1;
}

function trackToolCall(toolName: string, clientIp: string): void {
  analytics.totalToolCalls++;
  analytics.toolCalls[toolName] = (analytics.toolCalls[toolName] || 0) + 1;
  
  // Keep only last 100 recent calls
  analytics.recentToolCalls.unshift({
    tool: toolName,
    timestamp: new Date().toISOString(),
    clientIp,
  });
  if (analytics.recentToolCalls.length > 100) {
    analytics.recentToolCalls.pop();
  }
}

function getUptime(): string {
  const start = new Date(analytics.serverStartTime).getTime();
  const now = Date.now();
  const diff = now - start;
  
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

// Create MCP server
function createMcpServer(token: string): McpServer {
  const server = new McpServer({
    name: 'GitHub MCP Server',
    version: '1.0.0',
  });

  const octokit = new Octokit({ auth: token });

  // Register tool groups
  registerSearchTools(server, octokit);
  registerIssueTools(server, octokit);
  registerRepositoryTools(server, octokit);
  registerPullRequestTools(server, octokit);

  // Register hello tool for testing
  server.tool(
    'hello',
    'A simple test tool to verify that the MCP server is working correctly',
    {},
    async () => {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              message: 'Hello from GitHub MCP Server!',
              timestamp: new Date().toISOString(),
              transport: 'streamable-http',
              hasToken: !!token,
            }, null, 2),
          },
        ],
      };
    }
  );

  return server;
}

// Create Express app
const app = express();

// Middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Accept', 'Authorization', 'Mcp-Session-Id'],
  exposedHeaders: ['Mcp-Session-Id'],
}));

app.use(express.json());

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  trackRequest(req, '/health');
  res.json({
    status: 'healthy',
    server: 'GitHub MCP Server',
    version: '1.0.0',
    transport: 'streamable-http',
    hasToken: !!GITHUB_TOKEN,
    timestamp: new Date().toISOString(),
  });
});

// Analytics endpoint - summary
app.get('/analytics', (req: Request, res: Response) => {
  trackRequest(req, '/analytics');
  
  const sortedTools = Object.entries(analytics.toolCalls)
    .sort(([, a], [, b]) => b - a)
    .reduce((acc, [k, v]) => ({ ...acc, [k]: v }), {});
  
  const sortedClients = Object.entries(analytics.clientsByIp)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 20)
    .reduce((acc, [k, v]) => ({ ...acc, [k]: v }), {});
  
  const last24Hours = Object.entries(analytics.hourlyRequests)
    .sort(([a], [b]) => b.localeCompare(a))
    .slice(0, 24)
    .reverse()
    .reduce((acc, [k, v]) => ({ ...acc, [k]: v }), {});
  
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

// Analytics endpoint - detailed tool stats
app.get('/analytics/tools', (req: Request, res: Response) => {
  trackRequest(req, '/analytics/tools');
  
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

// Analytics dashboard - visual HTML page
app.get('/analytics/dashboard', (req: Request, res: Response) => {
  trackRequest(req, '/analytics/dashboard');
  
  const html = `
<!DOCTYPE html>
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
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>GitHub MCP Analytics</h1>
      <p>Real-time usage statistics</p>
    </header>
    
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
    </div>
    
    <div class="recent-calls">
      <h3>Recent Tool Calls</h3>
      <div id="recentCalls"></div>
    </div>
    
    <p class="refresh-note">Auto-refreshes every 30 seconds</p>
  </div>
  
  <script>
    let toolChart, hourlyChart;
    
    async function fetchData() {
      // Get base path from current URL (handles nginx reverse proxy paths like /github/)
      const basePath = window.location.pathname.replace(/\\/analytics\\/dashboard\\/?$/, '');
      const res = await fetch(basePath + '/analytics');
      return res.json();
    }
    
    function updateStats(data) {
      document.getElementById('stats').innerHTML = \`
        <div class="stat-card">
          <h3>Total Requests</h3>
          <div class="value">\${data.summary.totalRequests.toLocaleString()}</div>
        </div>
        <div class="stat-card">
          <h3>Tool Calls</h3>
          <div class="value">\${data.summary.totalToolCalls.toLocaleString()}</div>
        </div>
        <div class="stat-card">
          <h3>Unique Clients</h3>
          <div class="value">\${data.summary.uniqueClients.toLocaleString()}</div>
        </div>
        <div class="stat-card">
          <h3>Uptime</h3>
          <div class="value">\${data.uptime}</div>
        </div>
      \`;
    }
    
    function updateCharts(data) {
      const toolLabels = Object.keys(data.breakdown.byTool).slice(0, 10);
      const toolValues = Object.values(data.breakdown.byTool).slice(0, 10);
      
      if (toolChart) toolChart.destroy();
      toolChart = new Chart(document.getElementById('toolChart'), {
        type: 'doughnut',
        data: {
          labels: toolLabels,
          datasets: [{
            data: toolValues,
            backgroundColor: ['#58a6ff', '#a371f7', '#3fb950', '#f0883e', '#f85149', '#8b949e', '#6e7681', '#484f58', '#30363d', '#21262d']
          }]
        },
        options: {
          plugins: { legend: { position: 'right', labels: { color: '#e6edf3' } } }
        }
      });
      
      const hourlyLabels = Object.keys(data.hourlyRequests).map(h => h.slice(11, 16));
      const hourlyValues = Object.values(data.hourlyRequests);
      
      if (hourlyChart) hourlyChart.destroy();
      hourlyChart = new Chart(document.getElementById('hourlyChart'), {
        type: 'bar',
        data: {
          labels: hourlyLabels,
          datasets: [{
            label: 'Requests',
            data: hourlyValues,
            backgroundColor: '#58a6ff'
          }]
        },
        options: {
          scales: {
            y: { beginAtZero: true, ticks: { color: '#8b949e' }, grid: { color: 'rgba(255,255,255,0.1)' } },
            x: { ticks: { color: '#8b949e' }, grid: { color: 'rgba(255,255,255,0.1)' } }
          },
          plugins: { legend: { display: false } }
        }
      });
    }
    
    function updateRecentCalls(data) {
      const calls = data.recentToolCalls.slice(0, 10);
      document.getElementById('recentCalls').innerHTML = calls.map(call => \`
        <div class="call-item">
          <span class="call-tool">\${call.tool}</span>
          <span class="call-time">\${new Date(call.timestamp).toLocaleTimeString()}</span>
        </div>
      \`).join('') || '<p style="color:#8b949e;text-align:center;padding:20px;">No recent calls</p>';
    }
    
    async function refresh() {
      try {
        const data = await fetchData();
        console.log('Analytics data:', data);
        updateStats(data);
        updateCharts(data);
        updateRecentCalls(data);
      } catch (err) {
        console.error('Failed to load analytics:', err);
        document.getElementById('stats').innerHTML = '<p style="color:#f85149;text-align:center;padding:20px;">Failed to load analytics data</p>';
      }
    }
    
    refresh();
    setInterval(refresh, 30000);
  </script>
</body>
</html>
`;
  
  res.type('html').send(html);
});

// Root endpoint with server info
app.get('/', (req: Request, res: Response) => {
  trackRequest(req, '/');
  res.json({
    name: 'GitHub MCP Server',
    version: '1.0.0',
    description: 'MCP server for interacting with GitHub',
    transport: 'streamable-http',
    endpoints: {
      mcp: '/mcp',
      health: '/health',
      analytics: '/analytics',
      analyticsTools: '/analytics/tools',
      analyticsDashboard: '/analytics/dashboard',
    },
    documentation: 'https://github.com/hithereiamaliff/mcp-github',
  });
});

// Store active transports per token
const transports = new Map<string, StreamableHTTPServerTransport>();

// MCP endpoint - handles POST (requests), GET (SSE), DELETE (session close)
app.all('/mcp', async (req: Request, res: Response) => {
  trackRequest(req, '/mcp');
  
  // Get token from query param, header, or environment
  const token = (req.query.token as string) || 
                (req.headers['x-github-token'] as string) || 
                GITHUB_TOKEN;
  
  if (!token) {
    res.status(401).json({
      jsonrpc: '2.0',
      error: {
        code: -32001,
        message: 'GitHub token required. Provide via ?token=YOUR_TOKEN query param, X-GitHub-Token header, or GITHUB_PERSONAL_ACCESS_TOKEN environment variable.',
      },
      id: null,
    });
    return;
  }
  
  // Track tool calls from request body
  if (req.body?.method === 'tools/call' && req.body?.params?.name) {
    trackToolCall(req.body.params.name, getClientIp(req));
  }
  
  try {
    // Get or create transport for this token
    let transport = transports.get(token);
    if (!transport) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // Stateless transport
      });
      
      const mcpServer = createMcpServer(token);
      await mcpServer.server.connect(transport);
      transports.set(token, transport);
    }
    
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error('MCP request error:', error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: 'Internal server error',
        },
        id: null,
      });
    }
  }
});

// Start server
app.listen(PORT, HOST, () => {
  console.log('='.repeat(60));
  console.log('🐙 GitHub MCP Server (Streamable HTTP)');
  console.log('='.repeat(60));
  console.log(`📍 Server running on http://${HOST}:${PORT}`);
  console.log(`📡 MCP endpoint: http://${HOST}:${PORT}/mcp`);
  console.log(`❤️  Health check: http://${HOST}:${PORT}/health`);
  console.log(`📊 Analytics: http://${HOST}:${PORT}/analytics/dashboard`);
  console.log(`🔑 Token: ${GITHUB_TOKEN ? 'Configured via env' : 'Required via query param'}`);
  console.log('='.repeat(60));
});
