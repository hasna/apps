# Makefile for connect-zendesk
#
# Common commands:
#   make install     - Install dependencies
#   make dev         - Run CLI in development mode
#   make server      - Run server in development mode
#   make build       - Build for production
#   make deploy      - Deploy to EC2 instance
#   make typecheck   - Run TypeScript type checking
#   make clean       - Remove build artifacts

.PHONY: install dev server server-prod build typecheck test clean help link unlink deploy deploy-ec2 deploy-sync logs ssh npm-publish

# Configuration
EC2_HOST ?= hasna-prod-connect-zendesk
EC2_USER ?= ec2-user
DEPLOY_PATH ?= /home/ec2-user/connectors/connect-zendesk
SERVICE_NAME ?= connect-zendesk
PORT ?= 21010
# Public URL the deployed server is reachable at. Deployment-specific — no default.
REMOTE_API_URL ?=

# Default target
help:
	@echo "Available commands:"
	@echo "  make install       - Install dependencies"
	@echo "  make dev           - Run CLI in development mode"
	@echo "  make server        - Run server in development mode"
	@echo "  make server-prod   - Run server in production mode"
	@echo "  make build         - Build for production"
	@echo "  make test          - Run tests"
	@echo "  make typecheck     - Run TypeScript type checking"
	@echo "  make clean         - Remove build artifacts"
	@echo "  make link          - Link CLI globally for development"
	@echo "  make unlink        - Unlink CLI"
	@echo ""
	@echo "Deployment:"
	@echo "  make deploy        - Deploy to EC2 instance (build + sync + restart)"
	@echo "  make deploy-sync   - Sync files to EC2 (without restart)"
	@echo "  make logs          - View server logs on EC2"
	@echo "  make ssh           - SSH into EC2 instance"
	@echo ""
	@echo "Publishing:"
	@echo "  make npm-publish   - Publish to npm"

install:
	bun install

dev:
	bun run dev

server:
	PORT=$(PORT) bun run server

server-prod:
	PORT=$(PORT) NODE_ENV=production bun run server

build:
	bun run build

test:
	bun test

typecheck:
	bun run typecheck

clean:
	rm -rf dist bin server node_modules/.cache

link:
	bun link

unlink:
	bun unlink @hasna/connect-zendesk

# Deployment targets
deploy-sync:
	@echo "Syncing to $(EC2_HOST):$(DEPLOY_PATH)..."
	rsync -avz --delete \
		--exclude='.git' \
		--exclude='node_modules' \
		--exclude='.env.local' \
		. $(EC2_USER)@$(EC2_HOST):$(DEPLOY_PATH)/

deploy-ec2: deploy-sync
	@echo "Installing dependencies on EC2..."
	ssh $(EC2_USER)@$(EC2_HOST) "cd $(DEPLOY_PATH) && bun install --production"
	@echo "Building on EC2..."
	ssh $(EC2_USER)@$(EC2_HOST) "cd $(DEPLOY_PATH) && bun run build"
	@echo "Restarting service..."
	ssh $(EC2_USER)@$(EC2_HOST) "sudo systemctl restart $(SERVICE_NAME) || sudo systemctl start $(SERVICE_NAME)"
	@echo "Checking service status..."
	ssh $(EC2_USER)@$(EC2_HOST) "sudo systemctl status $(SERVICE_NAME) --no-pager"

deploy: build deploy-ec2
	@echo "✅ Deployment complete"
	@echo "Server running at $(if $(REMOTE_API_URL),$(REMOTE_API_URL),<REMOTE_API_URL not set>)"

logs:
	ssh $(EC2_USER)@$(EC2_HOST) "sudo journalctl -u $(SERVICE_NAME) -f"

ssh:
	ssh $(EC2_USER)@$(EC2_HOST)

# NPM publishing
npm-publish: build test
	@echo "Publishing to npm..."
	npm publish --access public
	@echo "✅ Published to npm"

# Create systemd service file
systemd-service:
	@echo "[Unit]" > connect-zendesk.service
	@echo "Description=connect-zendesk API Server" >> connect-zendesk.service
	@echo "After=network.target" >> connect-zendesk.service
	@echo "" >> connect-zendesk.service
	@echo "[Service]" >> connect-zendesk.service
	@echo "Type=simple" >> connect-zendesk.service
	@echo "User=ec2-user" >> connect-zendesk.service
	@echo "WorkingDirectory=$(DEPLOY_PATH)" >> connect-zendesk.service
	@echo "ExecStart=/home/ec2-user/.bun/bin/bun run $(DEPLOY_PATH)/server/index.js" >> connect-zendesk.service
	@echo "Restart=always" >> connect-zendesk.service
	@echo "RestartSec=10" >> connect-zendesk.service
	@echo "Environment=NODE_ENV=production" >> connect-zendesk.service
	@echo "Environment=PORT=$(PORT)" >> connect-zendesk.service
	@echo "" >> connect-zendesk.service
	@echo "[Install]" >> connect-zendesk.service
	@echo "WantedBy=multi-user.target" >> connect-zendesk.service
	@echo "Created connect-zendesk.service"
	@echo "Copy to EC2: scp connect-zendesk.service $(EC2_USER)@$(EC2_HOST):/tmp/"
	@echo "Then run: sudo mv /tmp/connect-zendesk.service /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable connect-zendesk"
