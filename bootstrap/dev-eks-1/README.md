# Bootstrap — dev-eks-1

This directory holds the Argo CD installation manifests and root-level resources for
the `dev-eks-1` cluster.

## Cluster details

| Field | Value |
| --- | --- |
| Cluster | `dev-eks-1` |
| AWS account | `111122223333` |
| Region | `ap-southeast-2` |
| Compute mode | EKS Auto Mode |

## How bootstrap is applied

Bootstrap manifests are applied manually or via a separate provisioning process — they
are **not** managed by Argo CD itself. Argo CD cannot install or upgrade itself through
its own sync loop, so these resources live outside the ApplicationSet discovery path.

## Current state

Install manifests will be added here when the `dev-eks-1` cluster is provisioned. Until
then this directory serves as a placeholder to establish the expected layout. Use the
`manage-clusters` skill to populate it with Argo CD Helm values and root Applications.

## Gatekeeper

A root Application syncs `infrastructure/gatekeeper/overlays/dev-eks-1/` to install the
OPA Gatekeeper operator and admission policies on this cluster.

### Application settings

| Field | Value |
| --- | --- |
| `spec.project` | `default` |
| `spec.destination.name` | `in-cluster` |
| `spec.source.targetRevision` | `main` |
| `spec.source.path` | `infrastructure/gatekeeper/overlays/dev-eks-1/` |

### Apply order

1. Argo CD must be healthy on the cluster before Gatekeeper is applied.
2. Gatekeeper operator overlay syncs first:
   - `gatekeeper-system` Namespace (sync-wave -1)
   - Operator Application installing the vendored Helm chart (sync-wave 0)
3. Nested Policies Application (sync-wave 2) syncs after the operator is healthy:
   - ConstraintTemplates (sync-wave 1)
   - Constraints (sync-wave 2)

Argo CD does not advance to later waves while earlier waves are unhealthy, so the
operator is guaranteed ready before policies land.

### Ordering constraint

Gatekeeper must **not** be applied before Argo CD is available on the cluster. Until
`dev-eks-1` is provisioned and Argo CD is running, these manifests remain Git-only.
