#!/usr/bin/env bash
set -euo pipefail

export AWS_REGION="${AWS_REGION:-us-east-1}"
export SHORTLINKS_HOME="/var/lib/shortlinks"
export SHORTLINKS_PACKAGE="@hasna/shortlinks@latest"
export SHORTLINKS_DATABASE_SECRET_ID="${SHORTLINKS_DATABASE_SECRET_ID:-hasna/xyz/opensource/shortlinks/prod/postgres}"

dnf update -y
dnf install -y awscli jq tar gzip shadow-utils libcap

if ! id shortlinks >/dev/null 2>&1; then
  useradd --system --create-home --home-dir "${SHORTLINKS_HOME}" --shell /sbin/nologin shortlinks
fi

install -d -o shortlinks -g shortlinks "${SHORTLINKS_HOME}/.hasna/shortlinks"
cat > /etc/shortlinks.env <<ENV
SHORTLINKS_DATABASE_SECRET_ID=${SHORTLINKS_DATABASE_SECRET_ID}
HASNA_SHORTLINKS_STORE=postgres
HASNA_SHORTLINKS_DATABASE_SSL=true
ENV
chown root:shortlinks /etc/shortlinks.env
chmod 640 /etc/shortlinks.env

su -s /bin/bash shortlinks -c 'curl -fsSL https://bun.sh/install | bash'
su -s /bin/bash shortlinks -c "${SHORTLINKS_HOME}/.bun/bin/bun install -g ${SHORTLINKS_PACKAGE} --no-cache"

cat > /usr/local/bin/shortlinks-env-exec <<'RUNNER'
#!/usr/bin/env bash
set -euo pipefail

export AWS_REGION="${AWS_REGION:-us-east-1}"
export HOME="/var/lib/shortlinks"
export PATH="/var/lib/shortlinks/.bun/bin:/usr/local/bin:/usr/bin:/bin"
export HASNA_SHORTLINKS_STORE="postgres"
export HASNA_SHORTLINKS_DATABASE_SSL="${HASNA_SHORTLINKS_DATABASE_SSL:-true}"

secret_json="$(aws secretsmanager get-secret-value \
  --region "${AWS_REGION}" \
  --secret-id "${SHORTLINKS_DATABASE_SECRET_ID:-hasna/xyz/opensource/shortlinks/prod/postgres}" \
  --query SecretString \
  --output text)"

connection_url="$(jq -r '(.connectionString // .connection_string // .url // .database_url // empty)' <<<"${secret_json}")"
if [[ -z "${connection_url}" ]]; then
  db_host="$(jq -r '.host // empty' <<<"${secret_json}")"
  db_port="$(jq -r '.port // 5432' <<<"${secret_json}")"
  db_name="$(jq -r '.database // .dbname // "shortlinks"' <<<"${secret_json}")"
  db_user="$(jq -r '.username // .user // empty' <<<"${secret_json}")"
  db_password="$(jq -r '.password // empty' <<<"${secret_json}")"
  if [[ -z "${db_host}" || -z "${db_user}" || -z "${db_password}" ]]; then
    echo "Shortlinks database secret must include connectionString/url or host, username, and password." >&2
    exit 1
  fi
  db_user_encoded="$(jq -nr --arg value "${db_user}" '$value|@uri')"
  db_password_encoded="$(jq -nr --arg value "${db_password}" '$value|@uri')"
  connection_url="postgres://${db_user_encoded}:${db_password_encoded}@${db_host}:${db_port}/${db_name}"
fi

export HASNA_SHORTLINKS_DATABASE_URL="${connection_url}"

exec "$@"
RUNNER
chmod 750 /usr/local/bin/shortlinks-env-exec
chown root:shortlinks /usr/local/bin/shortlinks-env-exec

su -s /bin/bash shortlinks -c 'PATH=/var/lib/shortlinks/.bun/bin:$PATH shortlinks --version'

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
EnvironmentFile=/etc/shortlinks.env
ExecStartPre=/usr/local/bin/shortlinks-env-exec shortlinks postgres migrate
ExecStart=/usr/local/bin/shortlinks-env-exec shortlinks --store postgres serve --host 127.0.0.1 --port 8787 --default-host has.na
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
cat > /etc/caddy/Caddyfile <<'CADDY'
has.na {
  encode zstd gzip
  reverse_proxy 127.0.0.1:8787
}
CADDY

systemctl daemon-reload
systemctl enable shortlinks.service caddy.service
systemctl start shortlinks.service
systemctl start caddy.service
