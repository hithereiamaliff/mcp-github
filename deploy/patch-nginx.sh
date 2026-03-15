#!/bin/bash
# Patches the nginx config for mcp.techmavie.digital to add:
# 1. proxy_request_buffering off; to the /github/ block
# 2. OAuth metadata 404 handlers (if not already present)
#
# NOTE: Server card is NOT added here because mcp-nextcloud already owns
# /.well-known/mcp/server-card.json via its snippet. The GitHub server card
# is accessible at /github/.well-known/mcp/server-card.json through the
# existing /github/ proxy block.
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

# 2. Add OAuth metadata 404 handlers (if not already present)
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
