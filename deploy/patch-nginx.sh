#!/bin/bash
# Patches the nginx config for mcp.techmavie.digital to add:
# 1. proxy_request_buffering off; to the /github/ block
# 2. Server card location block
# 3. OAuth metadata 404 handlers
#
# Usage: bash /opt/mcp-servers/github/deploy/patch-nginx.sh

NGINX_CONF="/etc/nginx/sites-available/mcp.techmavie.digital"

if [ ! -f "$NGINX_CONF" ]; then
    echo "ERROR: $NGINX_CONF not found"
    exit 1
fi

# Backup first
cp "$NGINX_CONF" "${NGINX_CONF}.bak.$(date +%Y%m%d%H%M%S)"
echo "Backup created."

# 1. Add proxy_request_buffering off; to the /github/ block
#    Insert after "proxy_cache off;" in the github block (before "# Allow large request bodies")
if grep -q "proxy_request_buffering off" "$NGINX_CONF"; then
    echo "SKIP: proxy_request_buffering already present"
else
    sed -i '/location \/github\//,/^    }/ {
        /proxy_cache off;/ {
            a\        proxy_request_buffering off;
        }
    }' "$NGINX_CONF"
    echo "DONE: Added proxy_request_buffering off to /github/ block"
fi

# 2. Add server card and OAuth 404 blocks before the nextcloud server card include
if grep -q "well-known/mcp/server-card.json" "$NGINX_CONF"; then
    echo "SKIP: server-card location already present"
else
    sed -i '/include \/etc\/nginx\/snippets\/mcp-nextcloud-server-card.conf;/i\
    # GitHub MCP Server - server card (root-level)\
    location = /.well-known/mcp/server-card.json {\
        proxy_pass http://127.0.0.1:8084/.well-known/mcp/server-card.json;\
        proxy_http_version 1.1;\
        proxy_set_header Host $host;\
        proxy_set_header X-Real-IP $remote_addr;\
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\
        proxy_set_header X-Forwarded-Proto $scheme;\
    }' "$NGINX_CONF"
    echo "DONE: Added server-card location block"
fi

# 3. Add OAuth metadata 404 handlers
if grep -q "oauth-protected-resource" "$NGINX_CONF"; then
    echo "SKIP: OAuth 404 handlers already present"
else
    sed -i '/include \/etc\/nginx\/snippets\/mcp-nextcloud-server-card.conf;/i\
    # OAuth metadata - deliberate 404 (not supported)\
    location /.well-known/oauth-protected-resource/ {\
        return 404 '\''{"error": "oauth_not_supported", "message": "This server uses API key authentication, not OAuth"}'\'';\
        add_header Content-Type application/json;\
    }\
\
    location /.well-known/oauth-authorization-server/ {\
        return 404 '\''{"error": "oauth_not_supported", "message": "This server uses API key authentication, not OAuth"}'\'';\
        add_header Content-Type application/json;\
    }' "$NGINX_CONF"
    echo "DONE: Added OAuth 404 handlers"
fi

echo ""
echo "Testing nginx config..."
nginx -t 2>&1

if [ $? -eq 0 ]; then
    echo ""
    echo "Config is valid. Run: sudo systemctl reload nginx"
else
    echo ""
    echo "ERROR: nginx config test failed! Restoring backup..."
    LATEST_BAK=$(ls -t "${NGINX_CONF}.bak."* 2>/dev/null | head -1)
    if [ -n "$LATEST_BAK" ]; then
        cp "$LATEST_BAK" "$NGINX_CONF"
        echo "Restored from $LATEST_BAK"
    fi
fi
