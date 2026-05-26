#!/bin/bash
# Initialize a new connector from the scaffold-connect template
#
# Usage: ./scripts/init.sh <connector-name> [service-display-name]
#
# Examples:
#   ./scripts/init.sh notion "Notion"
#   ./scripts/init.sh gmail "Gmail"
#   ./scripts/init.sh github "GitHub"
#
# This will replace all placeholders:
#   {{CONNECTOR_NAME}}      -> connector-name (lowercase)
#   {{SERVICE_NAME}}        -> Service Display Name
#   {{SERVICE_NAME_UPPER}}  -> SERVICE_NAME (uppercase with underscores)
#   {{SERVICE_NAME_PASCAL}} -> ServiceName (PascalCase)

set -e

if [ -z "$1" ]; then
    echo "Usage: $0 <connector-name> [service-display-name]"
    echo ""
    echo "Examples:"
    echo "  $0 notion 'Notion'"
    echo "  $0 gmail 'Gmail'"
    echo "  $0 github 'GitHub'"
    exit 1
fi

CONNECTOR_NAME="$1"
SERVICE_NAME="${2:-$CONNECTOR_NAME}"

# Convert to different cases
SERVICE_NAME_UPPER=$(echo "$SERVICE_NAME" | tr '[:lower:]' '[:upper:]' | tr ' ' '_' | tr '-' '_')
SERVICE_NAME_PASCAL=$(echo "$SERVICE_NAME" | sed 's/[- ]//g')

echo "Initializing connector: connect-$CONNECTOR_NAME"
echo "Service name: $SERVICE_NAME"
echo "Environment variable prefix: ${SERVICE_NAME_UPPER}_"
echo "Class name: $SERVICE_NAME_PASCAL"
echo ""

# Find all files and replace placeholders
find . -type f \( -name "*.ts" -o -name "*.json" -o -name "*.md" -o -name ".env*" -o -name ".gitignore" \) ! -path "./node_modules/*" ! -path "./scripts/*" | while read -r file; do
    if grep -q "{{CONNECTOR_NAME}}\|{{SERVICE_NAME}}\|{{SERVICE_NAME_UPPER}}\|{{SERVICE_NAME_PASCAL}}" "$file" 2>/dev/null; then
        echo "Processing: $file"
        sed -i '' \
            -e "s/{{CONNECTOR_NAME}}/$CONNECTOR_NAME/g" \
            -e "s/{{SERVICE_NAME_PASCAL}}/$SERVICE_NAME_PASCAL/g" \
            -e "s/{{SERVICE_NAME_UPPER}}/$SERVICE_NAME_UPPER/g" \
            -e "s/{{SERVICE_NAME}}/$SERVICE_NAME/g" \
            "$file"
    fi
done

echo ""
echo "Done! Next steps:"
echo "  1. cd connect-$CONNECTOR_NAME"
echo "  2. bun install"
echo "  3. Update src/api/client.ts with the correct API base URL"
echo "  4. Add API modules in src/api/"
echo "  5. Add CLI commands in src/cli/index.ts"
echo "  6. bun run dev to test"
