# Vendored Gatekeeper Helm Chart

## Source

| Field | Value |
| --- | --- |
| Upstream Helm repo | <https://open-policy-agent.github.io/gatekeeper/charts> |
| Chart | `gatekeeper` |
| Pinned version | `3.21.1` |

## Pull command

```bash
helm pull gatekeeper \
  --repo https://open-policy-agent.github.io/gatekeeper/charts \
  --version 3.21.1 \
  --untar \
  -d infrastructure/gatekeeper/base/vendored/chart/
```

## Why vendored

Managed Argo CD installations often have a single Git credential (e.g. AWS
CodeConnections) that gets sent to non-Git HTTP endpoints, causing chart fetches from
external Helm repos to fail. Vendoring the chart in Git makes the operator sync
self-contained with no runtime dependency on the public Helm registry.

## Upgrading

1. Update `--version` in the pull command above.
2. Run the command from the repo root.
3. Commit the updated `chart/gatekeeper/` directory.
4. Update `base/application.yaml` Helm values if the new version requires changes.
