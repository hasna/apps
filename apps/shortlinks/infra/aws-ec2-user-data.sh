#!/usr/bin/env bash
set -euo pipefail

export AWS_REGION="${AWS_REGION:-us-east-1}"
export SHORTLINKS_HOME="/var/lib/shortlinks"
export SHORTLINKS_PACKAGE="@hasna/shortlinks@latest"
export RDS_SECRET_ID="${RDS_SECRET_ID:-}"
export RDS_HOST="${RDS_HOST:-}"
export RDS_USERNAME="${RDS_USERNAME:-}"
export SHORTLINKS_DOMAIN="${SHORTLINKS_DOMAIN:-}"
export ATTACHMENTS_ORIGIN="${ATTACHMENTS_ORIGIN:-}"
export SHORTLINKS_API_PATH_PREFIX="${SHORTLINKS_API_PATH_PREFIX:-/_shortlinks/api}"

: "${RDS_SECRET_ID:?Set RDS_SECRET_ID to the AWS Secrets Manager secret for the PostgreSQL database_url}"
: "${SHORTLINKS_DOMAIN:?Set SHORTLINKS_DOMAIN to the public host served by Caddy}"

dnf update -y
dnf install -y awscli jq tar gzip shadow-utils libcap

if ! id shortlinks >/dev/null 2>&1; then
  useradd --system --create-home --home-dir "${SHORTLINKS_HOME}" --shell /sbin/nologin shortlinks
fi

install -d -o shortlinks -g shortlinks "${SHORTLINKS_HOME}/.hasna/shortlinks/storage"
install -d -o shortlinks -g shortlinks "${SHORTLINKS_HOME}/.hasna/shortlinks"

if [ -n "${RDS_HOST}" ] && [ -n "${RDS_USERNAME}" ]; then
cat > "${SHORTLINKS_HOME}/.hasna/shortlinks/storage/config.json" <<CLOUD_CONFIG
{
  "rds": {
    "host": "${RDS_HOST}",
    "port": 5432,
    "username": "${RDS_USERNAME}",
    "password_env": "SHORTLINKS_CLOUD_DATABASE_PASSWORD",
    "ssl": true
  },
  "mode": "hybrid",
  "auto_sync_interval_minutes": 0,
  "sync": {
    "schedule_minutes": 0
  }
}
CLOUD_CONFIG
chown shortlinks:shortlinks "${SHORTLINKS_HOME}/.hasna/shortlinks/storage/config.json"
chmod 600 "${SHORTLINKS_HOME}/.hasna/shortlinks/storage/config.json"
fi

su -s /bin/bash shortlinks -c 'curl -fsSL https://bun.sh/install | bash'
su -s /bin/bash shortlinks -c "${SHORTLINKS_HOME}/.bun/bin/bun install -g ${SHORTLINKS_PACKAGE} --no-cache"

cat > /usr/local/bin/shortlinks-env-exec <<'RUNNER'
#!/usr/bin/env bash
set -euo pipefail

export AWS_REGION="${AWS_REGION:-us-east-1}"
export HOME="/var/lib/shortlinks"
export PATH="/var/lib/shortlinks/.bun/bin:/usr/local/bin:/usr/bin:/bin"
export NODE_TLS_REJECT_UNAUTHORIZED="0"

: "${RDS_SECRET_ID:?Set RDS_SECRET_ID to the AWS Secrets Manager secret for the PostgreSQL database_url}"

secret_json="$(aws secretsmanager get-secret-value \
  --region "${AWS_REGION}" \
  --secret-id "${RDS_SECRET_ID}" \
  --query SecretString \
  --output text)"

export HASNA_SHORTLINKS_DATABASE_URL
HASNA_SHORTLINKS_DATABASE_URL="$(jq -r '.database_url // empty' <<<"${secret_json}")"
if [ -n "${HASNA_SHORTLINKS_DATABASE_URL}" ]; then
  export SHORTLINKS_DATABASE_URL="${HASNA_SHORTLINKS_DATABASE_URL}"
else
  export SHORTLINKS_CLOUD_DATABASE_PASSWORD
  SHORTLINKS_CLOUD_DATABASE_PASSWORD="$(jq -r '.password // empty' <<<"${secret_json}")"
fi

exec "$@"
RUNNER
chmod 750 /usr/local/bin/shortlinks-env-exec
chown root:shortlinks /usr/local/bin/shortlinks-env-exec

su -s /bin/bash shortlinks -c 'PATH=/var/lib/shortlinks/.bun/bin:$PATH shortlinks --version'

cat > /etc/default/shortlinks <<SHORTLINKS_ENV
AWS_REGION=${AWS_REGION}
RDS_SECRET_ID=${RDS_SECRET_ID}
SHORTLINKS_DOMAIN=${SHORTLINKS_DOMAIN}
SHORTLINKS_STORE=remote
SHORTLINKS_API_PATH_PREFIX=${SHORTLINKS_API_PATH_PREFIX}
SHORTLINKS_ENV
chmod 640 /etc/default/shortlinks
chown root:shortlinks /etc/default/shortlinks

caddy_version="$(curl -fsSL https://api.github.com/repos/caddyserver/caddy/releases/latest | jq -r '.tag_name // "v2.10.2"' | sed 's/^v//')"
case "$(uname -m)" in
  aarch64|arm64) caddy_arch="arm64" ;;
  x86_64|amd64) caddy_arch="amd64" ;;
  *) caddy_arch="arm64" ;;
esac
curl -fsSL -o /tmp/caddy.tar.gz "https://github.com/caddyserver/caddy/releases/download/v${caddy_version}/caddy_${caddy_version}_linux_${caddy_arch}.tar.gz"
tar -xzf /tmp/caddy.tar.gz -C /tmp caddy
install -m 0755 /tmp/caddy /usr/local/bin/caddy
setcap cap_net_bind_service=+ep /usr/local/bin/caddy || true

cat > /etc/systemd/system/shortlinks.service <<'SERVICE'
[Unit]
Description=Shortlinks redirect server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=shortlinks
Group=shortlinks
WorkingDirectory=/var/lib/shortlinks
Environment=HOME=/var/lib/shortlinks
Environment=PATH=/var/lib/shortlinks/.bun/bin:/usr/local/bin:/usr/bin:/bin
EnvironmentFile=/etc/default/shortlinks
ExecStart=/usr/local/bin/shortlinks-env-exec shortlinks serve --remote --host 127.0.0.1 --port 8787 --default-host ${SHORTLINKS_DOMAIN} --api-path-prefix ${SHORTLINKS_API_PATH_PREFIX}
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
SERVICE

cat > /etc/systemd/system/caddy.service <<'SERVICE'
[Unit]
Description=Caddy web server for shortlinks
After=network-online.target shortlinks.service
Wants=network-online.target

[Service]
Type=simple
User=root
Group=root
ExecStart=/usr/local/bin/caddy run --environ --config /etc/caddy/Caddyfile
ExecReload=/usr/local/bin/caddy reload --config /etc/caddy/Caddyfile --force
TimeoutStopSec=5s
LimitNOFILE=1048576
PrivateTmp=true
ProtectSystem=full
AmbientCapabilities=CAP_NET_BIND_SERVICE
Restart=on-failure

[Install]
WantedBy=multi-user.target
SERVICE

install -d /etc/caddy
if [ -n "${ATTACHMENTS_ORIGIN}" ]; then
cat > /etc/caddy/Caddyfile <<CADDY
${SHORTLINKS_DOMAIN} {
  encode zstd gzip

  handle ${SHORTLINKS_API_PATH_PREFIX}* {
    respond "Not found" 404
  }

  handle /a/* {
    reverse_proxy ${ATTACHMENTS_ORIGIN}
  }

  handle /api/* {
    reverse_proxy ${ATTACHMENTS_ORIGIN}
  }

  handle /_shortlinks/* {
    reverse_proxy 127.0.0.1:8787
  }

  handle {
    reverse_proxy 127.0.0.1:8787
  }
}
CADDY
else
cat > /etc/caddy/Caddyfile <<CADDY
${SHORTLINKS_DOMAIN} {
  encode zstd gzip

  handle ${SHORTLINKS_API_PATH_PREFIX}* {
    respond "Not found" 404
  }

  handle /api* {
    respond "Not found" 404
  }

  handle {
    reverse_proxy 127.0.0.1:8787
  }
}
CADDY
fi

systemctl daemon-reload
systemctl enable shortlinks.service caddy.service
systemctl start shortlinks.service
systemctl start caddy.service || true
