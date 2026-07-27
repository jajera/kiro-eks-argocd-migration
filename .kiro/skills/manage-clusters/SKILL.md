---
name: manage-clusters
description: Change Argo CD bootstrap or ApplicationSet discovery for the dev-eks-1 and prod-eks-1 clusters, or install a cluster add-on that apps depend on. Use when changing how apps are discovered, editing bootstrap manifests, onboarding a cluster, or when an app needs a controller or CRD that is not installed.
---

# Manage cluster configuration

Cluster-wide configuration lives in this repo alongside the apps:

```text
bootstrap/               # Argo CD install and the root manifest list per cluster
clusters/dev-eks-1/      # ApplicationSet discovering apps/*/overlays/dev-eks-1
clusters/prod-eks-1/     # ApplicationSet discovering apps/*/overlays/prod-eks-1
```

Use this skill when the change is cluster-wide. App-level changes belong in
`apps/<app>/`.

## Discovery

Each cluster has an `ApplicationSet` matching `apps/*/overlays/<cluster>` and creating
one Argo CD Application per match, named `<app>-<cluster>`.

When editing one, re-apply it. An ApplicationSet does not pick up its own definition
from a Git change unless it is itself managed by an Application.

Check what a changed path pattern matches before applying it. Widening the pattern can
create Applications for overlays you did not intend to deploy.

## Keep the two clusters in step

A change to `clusters/dev-eks-1/` almost always needs the same change in
`clusters/prod-eks-1/`. Where they differ — sync policy, prune behaviour, a stricter
`AppProject` — make the difference deliberate and note why in the manifest.

Divergence between the two ApplicationSets means dev stops being a rehearsal for prod,
which is the only reason dev exists.

## Cluster add-ons

An app needing a controller that is not installed is a cluster change, not an app
change. Add it under `bootstrap/` or as its own Application, and roll it out to
`dev-eks-1` first.

Do not vendor a controller into an app's manifests to work around a missing add-on. The
second app that needs it inherits a duplicate.

On EKS Auto Mode the load balancer controller, storage driver, and node lifecycle are
already managed. Do not install competing add-ons.

## Onboarding another cluster

Both current clusters are fixed, but if a third is added:

1. Copy an existing `clusters/<cluster>/` directory and update the discovery path and
   the generated Application name template.
2. Add the new manifest to that cluster's bootstrap list.
3. Confirm the `AppProject` exists and permits the destination.
4. Add an overlay under every app, plus the cluster to each app's `iam.tf`.

Step 4 is the expensive one. Every app needs an overlay and a Pod Identity association
before it can run there.
