# Build stage
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src

# Copy project file
COPY dotnet-console.csproj .

# Restore dependencies
RUN dotnet restore "dotnet-console.csproj"

# Copy source code
COPY Program.cs .

# Publish the app
RUN dotnet publish "dotnet-console.csproj" -c Release -o /app/publish

# Runtime stage
FROM mcr.microsoft.com/dotnet/runtime:8.0
WORKDIR /app
COPY --from=build /app/publish .

# Install curl for health checks and cert fetching
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

# Copy entrypoint script
COPY docker-entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# Environment variables (can be overridden)
ENV ENABLE_SMOKE=true
ENV EMULATOR_ORIGIN=https://emulator:8443
ENV TENANT_ID=11111111-1111-1111-1111-111111111111
ENV CLIENT_ID=cccccccc-0000-0000-0000-000000000001
ENV API_SCOPE=https://graph.microsoft.com/.default
ENV EMULATOR_CERT=/cert/emulator-cert.pem

# Use entrypoint script
ENTRYPOINT ["/app/entrypoint.sh"]
