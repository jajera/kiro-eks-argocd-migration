#!/usr/bin/env bash
# Validate a kustomize overlay against Gatekeeper policies.
#
# Usage: scripts/gatekeeper-gator-test.sh <kustomize-root>
#
# Env:
#   POLICY_DIR  Kustomize root holding ConstraintTemplates and Constraints.
#               Default: policies/base in this repo.
#
# When POLICY_DIR contains policies/overlays/<cluster> and the target path names
# that cluster, the per-cluster bundle is used instead of the base bundle.
#
# Exits 0 without testing when tooling or policies are unavailable, so callers can
# invoke it unconditionally.
set -euo pipefail

target="${1:?usage: gatekeeper-gator-test.sh <kustomize-root>}"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
policy_root="${POLICY_DIR:-$repo_root/policies}"

if [[ ! -d "$policy_root" ]]; then
  echo "skip: no policy directory at $policy_root (set POLICY_DIR)" >&2
  exit 0
fi

for tool in gator kustomize python3; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "skip: $tool not on PATH" >&2
    exit 0
  fi
done

# Prefer a policy bundle matching the cluster named in the overlay path.
policy_dir="$policy_root/base"
cluster="$(sed -n 's|.*/overlays/\([^/]*\).*|\1|p' <<<"$target" | head -1)"
if [[ -n "$cluster" && -f "$policy_root/overlays/$cluster/kustomization.yaml" ]]; then
  policy_dir="$policy_root/overlays/$cluster"
fi

if [[ ! -f "$policy_dir/kustomization.yaml" ]]; then
  echo "skip: no kustomization.yaml under $policy_dir" >&2
  exit 0
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

kustomize build "$policy_dir" >"$tmp/policies.yaml"
kustomize build "$target" \
  | python3 "$repo_root/scripts/expand-pod-templates.py" >"$tmp/manifests.yaml"

echo "gator test: target=$target policies=$policy_dir"

# --deny-only mirrors cluster admission: dryrun constraints warn but do not block.
gator test --deny-only -f "$tmp/policies.yaml" -f "$tmp/manifests.yaml" </dev/null
