# Bootstrap — prod-eks-1

## Purpose

This directory holds Argo CD installation manifests and root-level resources for the
`prod-eks-1` cluster. These resources bring up Argo CD itself and any cluster-scoped
objects that must exist before ApplicationSets can discover and sync workloads.

## How bootstrap is applied

Bootstrap manifests are applied **manually** or via a separate provisioning process —
they are **not** managed by Argo CD. Argo CD cannot sync the resources that define its
own installation.

## Cluster details

| Field | Value |
| --- | --- |
| Cluster | `prod-eks-1` |
| Environment | `prod` |
| AWS account | `444455556666` |
| Region | `ap-southeast-2` |
| Compute mode | EKS Auto Mode |

## Current state

Install manifests will be added when the cluster is provisioned. Until then this
directory serves as a placeholder establishing the expected layout. Use the
`manage-clusters` skill to populate it with Argo CD install resources.

## Gatekeeper

A root Application syncs `infrastructure/gatekeeper/overlays/prod-eks-1/` to install the
OPA Gatekeeper operator and admission policies on this cluster.

### Application settings

| Field | Value |
| --- | --- |
| `spec.project` | `default` |
| `spec.destination.name` | `in-cluster` |
| `spec.source.targetRevision` | `main` |
| `spec.source.path` | `infrastructure/gatekeeper/overlays/prod-eks-1/` |

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
`prod-eks-1` is provisioned and Argo CD is running, these manifests remain Git-only.
