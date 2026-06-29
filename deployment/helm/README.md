# Entra Local Helm chart

This chart deploys Entra Local, the local Microsoft Entra ID emulator, into a Kubernetes cluster.
It creates a single Deployment, a Service, and optionally an Ingress, and it is designed to work
with the container image published to GitHub Container Registry.

## Requirements

- Kubernetes 1.27+
- Helm 3.8+

## Install from GitHub Container Registry

The chart is published as an OCI artifact through GitHub Packages. Install it with:

The deployment uses conservative pod security defaults (non-root, no privilege escalation, dropped capabilities, and a read-only root filesystem). Entra Local writes to `/app/data` for its SQLite database and TLS artifacts, so the chart mounts an `emptyDir` there to preserve that behavior.

```bash
helm upgrade --install entra-local \
  oci://ghcr.io/cmaneu/entra-local/entra-local-helm \
  --version 0.1.0
```

## Install with custom values

```bash
helm upgrade --install entra-local \
  oci://ghcr.io/cmaneu/entra-local/entra-local-helm \
  --version 0.1.0 \
  -f values.yaml
```

Example values for a local development cluster:

```yaml
service:
  type: LoadBalancer
  port: 8443
  targetPort: 8443

ingress:
  enabled: true
  className: nginx
  hosts:
    - host: entra-local.local
      paths:
        - path: /
          pathType: Prefix
```

## Upgrade a release

```bash
helm upgrade entra-local oci://ghcr.io/cmaneu/entra-local/entra-local-helm --version 0.1.0
```

## Uninstall a release

```bash
helm uninstall entra-local
```

## Local testing without a cluster

Render and lint the chart locally:

```bash
helm lint deployment/helm
helm template entra-local deployment/helm >/tmp/entra-local-rendered.yaml
helm package deployment/helm
```

## Local testing with a Kubernetes cluster

With kind, minikube, or Docker Desktop Kubernetes:

```bash
helm upgrade --install entra-local ./deployment/helm
kubectl get pods,svc,ingress
kubectl logs deploy/entra-local
helm uninstall entra-local
```

## Manual publishing workflow

The manual workflow at `.github/workflows/publish-helm-chart.yml` can be run from the GitHub UI.
It accepts optional `chart_version` and `app_version` inputs, lints the chart, renders it,
packages it, and publishes it to GitHub Container Registry as an OCI artifact.

## Important values

The most important settings are:

- `image.repository` and `image.tag`
- `replicaCount`
- `service.type`, `service.port`, and `service.targetPort`
- `ingress.enabled`, `ingress.className`, and `ingress.hosts`
- `resources`
- `env`
- `nodeSelector`, `tolerations`, and `affinity`

## Release process

1. Update chart metadata in `deployment/helm/Chart.yaml`.
2. Bump the chart version when the chart changes.
3. Bump the application version when the container image version changes.
4. Merge the change to `main`.
5. Trigger `.github/workflows/publish-helm-chart.yml` manually.
6. Confirm the OCI package appears under GitHub Packages.
7. Verify the release by installing the published chart from GHCR.
