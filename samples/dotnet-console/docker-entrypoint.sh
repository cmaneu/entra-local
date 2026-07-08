#!/bin/sh
set -e

EMULATOR_ORIGIN=${EMULATOR_ORIGIN:-https://emulator:8443}
EMULATOR_CERT=${EMULATOR_CERT:-/cert/emulator-cert.pem}
TENANT_ID=${TENANT_ID:-11111111-1111-1111-1111-111111111111}
MAX_RETRIES=30
RETRY_DELAY=2

echo "=== Entra Local .NET Console Sample ==="
echo "Emulator origin: $EMULATOR_ORIGIN"
echo "Tenant ID: $TENANT_ID"
echo "Enable smoke mode: $ENABLE_SMOKE"
echo ""

# Wait for emulator to be ready
echo "Waiting for emulator to be ready..."
RETRIES=0
while [ $RETRIES -lt $MAX_RETRIES ]; do
  if curl -f -k "$EMULATOR_ORIGIN/$TENANT_ID/v2.0/.well-known/openid-configuration" > /dev/null 2>&1; then
    echo "✓ Emulator is ready"
    break
  fi
  RETRIES=$((RETRIES + 1))
  if [ $RETRIES -lt $MAX_RETRIES ]; then
    echo "  Attempt $RETRIES/$MAX_RETRIES failed, retrying in ${RETRY_DELAY}s..."
    sleep $RETRY_DELAY
  fi
done

if [ $RETRIES -eq $MAX_RETRIES ]; then
  echo "✗ Emulator failed to become ready after $(($MAX_RETRIES * $RETRY_DELAY))s"
  exit 1
fi

# Fetch and cache the emulator certificate
CERT_DIR=$(dirname "$EMULATOR_CERT")
if [ ! -f "$EMULATOR_CERT" ]; then
  echo "Downloading emulator certificate..."
  mkdir -p "$CERT_DIR"
  curl -f -k -o "$EMULATOR_CERT" "$EMULATOR_ORIGIN/admin/api/certificate/pem" || {
    echo "⚠ Failed to download certificate from API, continuing without local cert file"
  }
else
  echo "✓ Certificate found at $EMULATOR_CERT"
fi

echo ""
echo "Starting .NET console sample..."
echo "---"
echo ""

# Run the app (smoke mode by default, or interactive if ENABLE_SMOKE=false)
if [ "$ENABLE_SMOKE" = "true" ]; then
  exec dotnet dotnet-console.dll --smoke
else
  exec dotnet dotnet-console.dll
fi
