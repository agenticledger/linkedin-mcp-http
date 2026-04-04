#!/usr/bin/env node
/**
 * LinkedIn MCP Server — Exposed via Streamable HTTP
 *
 * Auth model: Dual-mode — supports both direct Bearer passthrough
 * and OAuth 2.0 Client Credentials grant.
 * No permanent credentials are stored on the server.
 */

import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { zodToJsonSchema as _zodToJsonSchema } from 'zod-to-json-schema';
import { LinkedInClient } from './api-client.js';
import { tools } from './tools.js';

function zodToJsonSchema(schema: any): any {
  return _zodToJsonSchema(schema);
}

const PORT = parseInt(process.env.PORT || '3100', 10);
const SERVER_BASE_URL = process.env.SERVER_BASE_URL || `http://localhost:${PORT}`;
const SLUG = 'linkedin';

// LinkedIn OAuth App credentials (for the /auth/connect flow)
const LINKEDIN_CLIENT_ID = process.env.LINKEDIN_CLIENT_ID || '';
const LINKEDIN_CLIENT_SECRET = process.env.LINKEDIN_CLIENT_SECRET || '';
const LINKEDIN_REDIRECT_URI = `${SERVER_BASE_URL}/auth/callback`;
const LINKEDIN_SCOPES = 'openid profile email w_member_social';

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// --- OAuth token store (in-memory, ephemeral) ---
const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

interface OAuthToken {
  apiKey: string;
  expiresAt: number;
}

const oauthTokens = new Map<string, OAuthToken>();

// Cleanup expired tokens every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [token, data] of oauthTokens) {
    if (now > data.expiresAt) oauthTokens.delete(token);
  }
}, 10 * 60 * 1000);

// --- Static assets (logo) ---
const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use('/static', express.static(path.join(__dirname, 'public')));

// Health check (no auth required)
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    server: 'linkedin-mcp-http',
    version: '1.0.0',
    tools: tools.length,
    transport: 'streamable-http',
    auth: 'dual-mode',
    auth_modes: ['bearer-passthrough', 'oauth-client-credentials'],
  });
});

// --- OAuth 2.0 Discovery ---
app.get('/.well-known/oauth-authorization-server', (_req, res) => {
  res.json({
    issuer: SERVER_BASE_URL,
    token_endpoint: `${SERVER_BASE_URL}/oauth/token`,
    revocation_endpoint: `${SERVER_BASE_URL}/oauth/revoke`,
    grant_types_supported: ['client_credentials'],
    token_endpoint_auth_methods_supported: ['client_secret_post'],
    response_types_supported: ['token'],
    service_documentation: `https://financemcps.agenticledger.ai/linkedin/`,
  });
});

// --- OAuth 2.0 Token Exchange ---
app.post('/oauth/token', (req, res) => {
  const { grant_type, client_id, client_secret } = req.body;

  if (grant_type !== 'client_credentials') {
    res.status(400).json({ error: 'unsupported_grant_type', error_description: 'Only client_credentials is supported' });
    return;
  }

  if (client_id !== SLUG) {
    res.status(400).json({ error: 'invalid_client', error_description: `client_id must be "${SLUG}"` });
    return;
  }

  if (!client_secret) {
    res.status(400).json({ error: 'invalid_request', error_description: 'client_secret is required (your LinkedIn access token)' });
    return;
  }

  const accessToken = `mcp_${randomUUID().replace(/-/g, '')}`;
  const expiresIn = TOKEN_TTL_MS / 1000;

  oauthTokens.set(accessToken, {
    apiKey: client_secret,
    expiresAt: Date.now() + TOKEN_TTL_MS,
  });

  res.json({
    access_token: accessToken,
    token_type: 'bearer',
    expires_in: expiresIn,
  });
});

// GET handler for browsers hitting /oauth/token
app.get('/oauth/token', (_req, res) => {
  res.json({
    endpoint: '/oauth/token',
    method: 'POST',
    description: 'Exchange your LinkedIn access token for a time-limited MCP token',
    usage: {
      grant_type: 'client_credentials',
      client_id: SLUG,
      client_secret: '<your-linkedin-access-token>',
    },
    example: `curl -X POST ${SERVER_BASE_URL}/oauth/token -d "grant_type=client_credentials&client_id=${SLUG}&client_secret=<your-token>"`,
  });
});

// --- OAuth 2.0 Token Revocation ---
app.post('/oauth/revoke', (req, res) => {
  const { token } = req.body;
  if (token) oauthTokens.delete(token);
  res.status(200).json({ status: 'revoked' });
});

// --- LinkedIn OAuth Authorization Flow (for users to get their access token) ---

// Step 1: User visits /auth/connect — shows branded page with "Authorize with LinkedIn" button
app.get('/auth/connect', (_req, res) => {
  if (!LINKEDIN_CLIENT_ID) {
    res.status(500).json({ error: 'LinkedIn OAuth not configured — missing LINKEDIN_CLIENT_ID env var' });
    return;
  }

  const authUrl = `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=${LINKEDIN_CLIENT_ID}&redirect_uri=${encodeURIComponent(LINKEDIN_REDIRECT_URI)}&scope=${encodeURIComponent(LINKEDIN_SCOPES)}&state=${randomUUID()}`;

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Connect LinkedIn — AgenticLedger</title>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root{--primary:#0A66C2;--fg:#0F172A;--muted:#64748B;--surface:#F8FAFC;--border:#E2E8F0;}
    *{margin:0;padding:0;box-sizing:border-box;}
    body{font-family:'DM Sans',sans-serif;color:var(--fg);min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--surface);background-image:linear-gradient(135deg,#EFF6FF 0%,var(--surface) 50%,#F0F9FF 100%);}
    .card{background:#fff;border:1px solid var(--border);border-radius:16px;padding:48px;max-width:480px;width:100%;margin:20px;box-shadow:0 1px 3px rgba(0,0,0,.04),0 8px 24px rgba(0,0,0,.06);text-align:center;}
    .card img{height:40px;margin-bottom:24px;}
    h1{font-size:24px;font-weight:700;margin-bottom:8px;}
    p{color:var(--muted);font-size:14px;line-height:1.6;margin-bottom:24px;}
    .scopes{text-align:left;background:#F1F5F9;border-radius:10px;padding:16px 20px;margin-bottom:28px;font-size:13px;}
    .scopes div{display:flex;align-items:center;gap:8px;padding:4px 0;}
    .scopes div::before{content:'\\2713';color:#10B981;font-weight:700;}
    .btn{display:inline-block;background:var(--primary);color:#fff;text-decoration:none;padding:14px 32px;border-radius:10px;font-size:15px;font-weight:600;font-family:'DM Sans',sans-serif;transition:background .2s;}
    .btn:hover{background:#004182;}
    .note{font-size:12px;color:var(--muted);margin-top:20px;line-height:1.5;}
  </style>
</head>
<body>
  <div class="card">
    <img src="/static/logo.png" alt="AgenticLedger">
    <h1>Connect Your LinkedIn</h1>
    <p>Authorize this MCP server to create posts, share articles, upload images, and engage with content on your behalf.</p>
    <div class="scopes">
      <div>Read your profile and email</div>
      <div>Create and delete posts</div>
      <div>Upload images</div>
      <div>Like and comment on posts</div>
    </div>
    <a href="${authUrl}" class="btn">Authorize with LinkedIn</a>
    <p class="note">You'll be redirected to LinkedIn to log in. After authorizing, you'll receive an access token valid for 60 days. Your credentials are never stored on this server.</p>
  </div>
</body>
</html>`);
});

// Step 2: LinkedIn redirects back with auth code — exchange for access token
app.get('/auth/callback', async (req, res) => {
  const { code, error, error_description } = req.query;

  if (error) {
    res.status(400).send(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Error</title>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600&family=JetBrains+Mono&display=swap" rel="stylesheet">
<style>body{font-family:'DM Sans',sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#F8FAFC;}.card{background:#fff;border:1px solid #E2E8F0;border-radius:16px;padding:40px;max-width:480px;text-align:center;box-shadow:0 8px 24px rgba(0,0,0,.06);}h1{color:#EF4444;margin-bottom:12px;}p{color:#64748B;font-size:14px;}a{color:#0A66C2;}</style>
</head><body><div class="card"><h1>Authorization Failed</h1><p>${error_description || error}</p><p style="margin-top:16px"><a href="/auth/connect">Try again</a></p></div></body></html>`);
    return;
  }

  if (!code || !LINKEDIN_CLIENT_ID || !LINKEDIN_CLIENT_SECRET) {
    res.status(400).json({ error: 'Missing authorization code or server configuration' });
    return;
  }

  try {
    // Exchange code for access token
    const tokenRes = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code as string,
        redirect_uri: LINKEDIN_REDIRECT_URI,
        client_id: LINKEDIN_CLIENT_ID,
        client_secret: LINKEDIN_CLIENT_SECRET,
      }),
    });

    const data: any = await tokenRes.json();

    if (!data.access_token) {
      res.status(400).send(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Error</title>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600&family=JetBrains+Mono&display=swap" rel="stylesheet">
<style>body{font-family:'DM Sans',sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#F8FAFC;}.card{background:#fff;border:1px solid #E2E8F0;border-radius:16px;padding:40px;max-width:480px;text-align:center;box-shadow:0 8px 24px rgba(0,0,0,.06);}h1{color:#EF4444;}pre{text-align:left;background:#1E293B;color:#E2E8F0;padding:16px;border-radius:8px;font-size:12px;overflow-x:auto;margin-top:16px;}a{color:#0A66C2;}</style>
</head><body><div class="card"><h1>Token Exchange Failed</h1><pre>${JSON.stringify(data, null, 2)}</pre><p style="margin-top:16px"><a href="/auth/connect">Try again</a></p></div></body></html>`);
      return;
    }

    const expiresInDays = Math.round((data.expires_in || 5184000) / 86400);

    // Build the MCP config for them
    const mcpConfig = JSON.stringify({
      mcpServers: {
        linkedin: {
          url: `${SERVER_BASE_URL}/mcp`,
          headers: { Authorization: `Bearer ${data.access_token}` }
        }
      }
    }, null, 2);

    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>LinkedIn Connected — AgenticLedger</title>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root{--primary:#0A66C2;--fg:#0F172A;--muted:#64748B;--surface:#F8FAFC;--border:#E2E8F0;--success:#10B981;}
    *{margin:0;padding:0;box-sizing:border-box;}
    body{font-family:'DM Sans',sans-serif;color:var(--fg);min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--surface);}
    .card{background:#fff;border:1px solid var(--border);border-radius:16px;padding:40px;max-width:600px;width:100%;margin:20px;box-shadow:0 8px 24px rgba(0,0,0,.06);}
    .success{display:flex;align-items:center;gap:10px;margin-bottom:20px;}
    .success-icon{width:32px;height:32px;background:var(--success);border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:18px;}
    h1{font-size:22px;font-weight:700;}
    .expires{color:var(--muted);font-size:13px;margin-bottom:24px;}
    .section{margin-bottom:20px;}
    .section-title{font-size:13px;font-weight:600;margin-bottom:8px;display:flex;align-items:center;justify-content:space-between;}
    .copy-btn{background:var(--primary);color:#fff;border:none;border-radius:6px;padding:4px 12px;font-size:12px;font-family:'DM Sans',sans-serif;cursor:pointer;font-weight:500;}
    .copy-btn.copied{background:var(--success);}
    textarea{width:100%;border:1px solid var(--border);border-radius:10px;padding:14px;font-family:'JetBrains Mono',monospace;font-size:12px;resize:vertical;background:#F8FAFC;}
    pre{background:#1E293B;color:#E2E8F0;border-radius:10px;padding:16px;font-family:'JetBrains Mono',monospace;font-size:12px;line-height:1.7;overflow-x:auto;white-space:pre;}
    .warning{background:#FEF3C7;border:1px solid #FDE68A;border-radius:8px;padding:12px 16px;font-size:12px;color:#92400E;margin-top:16px;line-height:1.5;}
    .footer{text-align:center;margin-top:20px;padding-top:16px;border-top:1px solid var(--border);font-size:12px;color:var(--muted);}
  </style>
</head>
<body>
  <div class="card">
    <div class="success"><div class="success-icon">&#10003;</div><h1>LinkedIn Connected!</h1></div>
    <p class="expires">Your token expires in <strong>${expiresInDays} days</strong>. Come back here to re-authorize when it expires.</p>

    <div class="section">
      <div class="section-title">Your Access Token <button class="copy-btn" onclick="copyText('tokenBox',this)">Copy</button></div>
      <textarea id="tokenBox" rows="3" readonly>${data.access_token}</textarea>
    </div>

    <div class="section">
      <div class="section-title">MCP Configuration <button class="copy-btn" onclick="copyText('configBox',this)">Copy</button></div>
      <pre id="configBox">${mcpConfig}</pre>
    </div>

    <div class="warning">
      <strong>Keep this token private.</strong> Anyone with this token can post to your LinkedIn. Do not share it publicly. If compromised, revoke it at <a href="https://www.linkedin.com/psettings/permitted-services" target="_blank">LinkedIn Settings</a>.
    </div>

    <div class="footer">Powered by AgenticLedger &middot; <a href="/" style="color:var(--primary);text-decoration:none;">Back to Server Info</a></div>
  </div>
  <script>
    function copyText(id,btn){
      var el=document.getElementById(id);
      var text=el.value||el.textContent;
      navigator.clipboard.writeText(text).then(function(){
        btn.textContent='Copied!';btn.classList.add('copied');
        setTimeout(function(){btn.textContent='Copy';btn.classList.remove('copied');},2000);
      });
    }
  </script>
</body>
</html>`);
  } catch (err: any) {
    res.status(500).json({ error: 'Token exchange failed', details: err.message });
  }
});

// --- Smart root route: content negotiation ---
app.get('/', (req, res) => {
  const accept = req.headers.accept || '';
  if (accept.includes('text/html')) {
    res.send(BRANDED_LANDING_HTML);
    return;
  }
  res.json({
    name: 'LinkedIn MCP Server',
    provider: 'AgenticLedger',
    version: '1.0.0',
    description: 'Create posts, share articles, upload images, react, and comment on LinkedIn',
    mcpEndpoint: '/mcp',
    transport: 'streamable-http',
    tools: tools.length,
    auth: {
      type: 'dual-mode',
      description: 'Supports both direct Bearer token and OAuth 2.0 Client Credentials',
      modes: {
        bearer: {
          description: 'Pass your LinkedIn access token directly as the Bearer token',
          header: 'Authorization: Bearer <your-linkedin-access-token>',
        },
        oauth: {
          description: 'Exchange credentials for a time-limited token',
          token_endpoint: `${SERVER_BASE_URL}/oauth/token`,
          client_id: SLUG,
          client_secret: '<your-linkedin-access-token>',
          grant_type: 'client_credentials',
        },
      },
    },
    configTemplate: {
      mcpServers: {
        'linkedin': {
          url: `${SERVER_BASE_URL}/mcp`,
          headers: { Authorization: 'Bearer <your-linkedin-access-token>' }
        }
      }
    },
    links: {
      health: '/health',
      documentation: 'https://financemcps.agenticledger.ai/linkedin/',
      oauth_discovery: '/.well-known/oauth-authorization-server',
    }
  });
});

// --- Dual-mode API key resolver ---
function resolveApiKey(req: express.Request): string | null {
  const auth = req.headers.authorization;
  if (!auth) return null;

  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) return null;

  // Mode 1: OAuth-issued token
  if (token.startsWith('mcp_')) {
    const entry = oauthTokens.get(token);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      oauthTokens.delete(token);
      return null;
    }
    return entry.apiKey;
  }

  // Mode 2: Raw API key passthrough
  return token;
}

// --- Per-session state ---
interface SessionState {
  server: Server;
  transport: StreamableHTTPServerTransport;
  client: LinkedInClient;
}

const sessions = new Map<string, SessionState>();

function createMCPServer(client: LinkedInClient): Server {
  const server = new Server(
    { name: 'linkedin-mcp-server', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: zodToJsonSchema(tool.inputSchema),
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const tool = tools.find((t) => t.name === name);

    if (!tool) {
      throw new Error(`Unknown tool: ${name}`);
    }

    try {
      const result = await tool.handler(client, args as any);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text' as const, text: `Error: ${message}` }],
        isError: true,
      };
    }
  });

  return server;
}

// --- Streamable HTTP endpoint ---
app.post('/mcp', async (req, res) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;

  if (sessionId && sessions.has(sessionId)) {
    const { transport } = sessions.get(sessionId)!;
    await transport.handleRequest(req, res, req.body);
    return;
  }

  const apiKey = resolveApiKey(req);
  if (!apiKey) {
    res.status(401).json({
      error: 'Missing or invalid Authorization header.',
      modes: {
        bearer: 'Authorization: Bearer <your-linkedin-access-token>',
        oauth: `POST ${SERVER_BASE_URL}/oauth/token with client_id=${SLUG}&client_secret=<your-linkedin-access-token>&grant_type=client_credentials`,
      },
    });
    return;
  }

  const client = new LinkedInClient(apiKey);

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });

  const server = createMCPServer(client);

  transport.onclose = () => {
    const sid = transport.sessionId;
    if (sid) {
      sessions.delete(sid);
      console.log(`[mcp] Session closed: ${sid}`);
    }
  };

  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);

  const newSessionId = transport.sessionId;
  if (newSessionId) {
    sessions.set(newSessionId, { server, transport, client });
    console.log(`[mcp] New session: ${newSessionId}`);
  }
});

app.get('/mcp', async (req, res) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  if (!sessionId || !sessions.has(sessionId)) {
    res.status(400).json({ error: 'Invalid or missing session. Send initialization POST first.' });
    return;
  }
  const { transport } = sessions.get(sessionId)!;
  await transport.handleRequest(req, res);
});

app.delete('/mcp', async (req, res) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  if (!sessionId || !sessions.has(sessionId)) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  const { transport, server } = sessions.get(sessionId)!;
  await transport.close();
  await server.close();
  sessions.delete(sessionId);
  res.status(200).json({ status: 'session closed' });
});

// ==================== BRANDED HTML HELPER PAGE ====================
const BRANDED_LANDING_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>LinkedIn MCP Server — AgenticLedger</title>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root{--primary:#0A66C2;--primary-dark:#004182;--primary-light:#D0E8FF;--primary-50:#EFF6FF;--fg:#0F172A;--muted:#64748B;--surface:#F8FAFC;--border:#E2E8F0;--success:#10B981;--success-light:#D1FAE5;}
    *{margin:0;padding:0;box-sizing:border-box;}
    body{font-family:'DM Sans',sans-serif;color:var(--fg);min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--surface);background-image:linear-gradient(135deg,var(--primary-50) 0%,var(--surface) 50%,#F0F9FF 100%);background-size:400% 400%;animation:gradientShift 15s ease infinite;}
    @keyframes gradientShift{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}
    .card{background:#fff;border:1px solid var(--border);border-radius:16px;padding:40px;max-width:560px;width:100%;margin:20px;box-shadow:0 1px 3px rgba(0,0,0,.04),0 8px 24px rgba(0,0,0,.06);animation:slideUp .5s ease-out;}
    @keyframes slideUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
    .header{display:flex;align-items:center;gap:14px;margin-bottom:28px;padding-bottom:20px;border-bottom:1px solid var(--border);}
    .header img{height:36px;}
    .header span{font-size:18px;font-weight:700;color:var(--fg);}
    .status-badge{display:inline-flex;align-items:center;gap:6px;background:var(--success-light);border:1px solid #A7F3D0;border-radius:20px;padding:6px 14px;font-size:13px;font-weight:600;color:#065F46;margin-bottom:20px;}
    .status-badge::before{content:'';width:8px;height:8px;border-radius:50%;background:var(--success);animation:pulse 2s infinite;}
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
    .info-grid{display:grid;gap:12px;margin-bottom:24px;}
    .info-row{display:flex;justify-content:space-between;align-items:center;padding:10px 14px;background:var(--primary-50);border-radius:10px;font-size:13px;}
    .info-row .label{color:var(--muted);font-weight:500;}
    .info-row .value{color:var(--fg);font-weight:600;font-family:'JetBrains Mono',monospace;font-size:12px;}
    .section-title{font-size:14px;font-weight:600;color:var(--fg);margin:24px 0 10px;display:flex;align-items:center;gap:8px;}
    .key-input{width:100%;padding:12px 16px;border:2px solid var(--border);border-radius:10px;font-family:'JetBrains Mono',monospace;font-size:13px;transition:border-color .2s;margin-bottom:8px;}
    .key-input:focus{outline:none;border-color:var(--primary);}
    .key-hint{font-size:12px;color:var(--muted);margin-bottom:20px;line-height:1.5;}
    .config-block{position:relative;}
    .config-pre{background:#1E293B;border-radius:12px;padding:20px;overflow-x:auto;font-family:'JetBrains Mono',monospace;font-size:12.5px;line-height:1.7;margin:0 0 24px;color:#E2E8F0;white-space:pre;}
    .config-copy{position:absolute;top:12px;right:12px;background:rgba(255,255,255,.1);color:#CBD5E1;border:1px solid rgba(255,255,255,.15);border-radius:8px;padding:6px 12px;font-family:'DM Sans',sans-serif;font-size:12px;cursor:pointer;transition:all .15s;}
    .config-copy:hover{background:rgba(255,255,255,.2);color:#fff;}
    .config-copy.copied{background:rgba(16,185,129,.3);color:#86EFAC;}
    .trust{display:flex;gap:16px;flex-wrap:wrap;padding-top:20px;border-top:1px solid var(--border);}
    .trust-item{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--muted);}
    .trust-item svg{width:14px;height:14px;color:var(--success);}
    .footer{padding-top:16px;border-top:1px solid var(--border);text-align:center;font-size:12px;color:var(--muted);margin-top:20px;}
  </style>
</head>
<body>
  <div class="card">
    <div class="header"><img src="/static/logo.png" alt="AgenticLedger"><span>LinkedIn MCP</span></div>
    <div class="status-badge">Server Online</div>
    <div class="info-grid">
      <div class="info-row"><span class="label">Tools</span><span class="value">${tools.length}</span></div>
      <div class="info-row"><span class="label">Transport</span><span class="value">Streamable HTTP</span></div>
      <div class="info-row"><span class="label">Auth</span><span class="value">Dual-Mode (Bearer + OAuth)</span></div>
    </div>

    <div class="section-title">Enter your LinkedIn Access Token</div>
    <input type="text" class="key-input" id="apiKeyInput" placeholder="AQX..." oninput="updateConfig()">
    <div class="key-hint">Your token stays in your browser — it is never sent to this server.</div>

    <div class="section-title">MCP Configuration (Bearer)</div>
    <p style="font-size:13px;color:var(--muted);margin-bottom:12px;">Add to your <strong style="color:var(--fg)">claude_desktop_config.json</strong> or <strong style="color:var(--fg)">.mcp.json</strong>:</p>
    <div class="config-block">
      <button class="config-copy" onclick="copyBlock('configBlock',this)">Copy</button>
      <pre class="config-pre" id="configBlock"></pre>
    </div>

    <div class="section-title">OAuth Configuration (Claude.ai / Agent Platforms)</div>
    <p style="font-size:13px;color:var(--muted);margin-bottom:12px;">For platforms that require OAuth Client Credentials:</p>
    <div class="config-block">
      <button class="config-copy" onclick="copyBlock('oauthBlock',this)">Copy</button>
      <pre class="config-pre" id="oauthBlock"></pre>
    </div>

    <div class="trust">
      <div class="trust-item"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></svg>No credentials stored</div>
      <div class="trust-item"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></svg>Stateless</div>
      <div class="trust-item"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></svg>Per-session auth</div>
    </div>
    <div class="footer">Powered by AgenticLedger &middot; <a href="https://financemcps.agenticledger.ai/" target="_blank" style="color:var(--primary);text-decoration:none">Explore Other MCPs</a></div>
  </div>
  <script>
    function updateConfig(){
      var key=document.getElementById('apiKeyInput').value||'<your-linkedin-access-token>';
      var config=JSON.stringify({mcpServers:{"linkedin":{url:"${SERVER_BASE_URL}/mcp",headers:{Authorization:"Bearer "+key}}}},null,2);
      document.getElementById('configBlock').textContent=config;
      var oauth="Token URL:      ${SERVER_BASE_URL}/oauth/token\\nClient ID:      ${SLUG}\\nClient Secret:  "+key+"\\nGrant Type:     client_credentials";
      document.getElementById('oauthBlock').textContent=oauth;
    }
    function copyBlock(id,btn){
      var text=document.getElementById(id).textContent;
      navigator.clipboard.writeText(text).then(function(){
        btn.textContent='Copied!';btn.classList.add('copied');
        setTimeout(function(){btn.textContent='Copy';btn.classList.remove('copied');},2000);
      });
    }
    updateConfig();
  </script>
</body>
</html>`;

app.listen(PORT, () => {
  console.log(`LinkedIn MCP HTTP Server running on port ${PORT}`);
  console.log(`  MCP endpoint:   ${SERVER_BASE_URL}/mcp`);
  console.log(`  OAuth token:    ${SERVER_BASE_URL}/oauth/token`);
  console.log(`  OAuth discovery: ${SERVER_BASE_URL}/.well-known/oauth-authorization-server`);
  console.log(`  Health check:   ${SERVER_BASE_URL}/health`);
  console.log(`  Landing page:   ${SERVER_BASE_URL}/`);
  console.log(`  Tools:          ${tools.length}`);
  console.log(`  Transport:      Streamable HTTP`);
  console.log(`  Auth:           Dual-mode (Bearer passthrough + OAuth Client Credentials)`);
});
