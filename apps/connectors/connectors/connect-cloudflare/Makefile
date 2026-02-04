# Makefile for connect-{{CONNECTOR_NAME}}
#
# Common commands:
#   make install     - Install dependencies
#   make dev         - Run CLI in development mode
#   make build       - Build for production
#   make typecheck   - Run TypeScript type checking
#   make clean       - Remove build artifacts

.PHONY: install dev build typecheck clean help

# Default target
help:
	@echo "Available commands:"
	@echo "  make install     - Install dependencies"
	@echo "  make dev         - Run CLI in development mode"
	@echo "  make build       - Build for production"
	@echo "  make typecheck   - Run TypeScript type checking"
	@echo "  make clean       - Remove build artifacts"
	@echo "  make link        - Link CLI globally for development"
	@echo "  make unlink      - Unlink CLI"

install:
	bun install

dev:
	bun run dev

build:
	bun run build

typecheck:
	bun run typecheck

clean:
	rm -rf dist bin node_modules/.cache

link:
	bun link

unlink:
	bun unlink connect-{{CONNECTOR_NAME}}

# AWS Infrastructure targets (customize as needed)
.PHONY: deploy-ec2 deploy-s3 deploy

deploy-ec2:
	@echo "Deploying to EC2 instance: beepmedia-prod-connect-{{CONNECTOR_NAME}}"
	# Add your EC2 deployment commands here

deploy-s3:
	@echo "Syncing to S3 bucket: beepmedia-prod-connect-{{CONNECTOR_NAME}}"
	# Add your S3 sync commands here

deploy: build deploy-ec2
	@echo "Deployment complete"
