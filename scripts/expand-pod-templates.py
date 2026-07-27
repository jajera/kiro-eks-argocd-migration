#!/usr/bin/env python3
"""Append synthetic Pods built from workload pod templates, for policy testing.

Gatekeeper constraints written against ``kind: Pod`` -- resource limits, privilege
escalation, security context -- do not match a Deployment or CronJob document. Testing
the controller manifests alone reports PASS while the admission webhook rejects the same
manifests in-cluster.

Reads multi-document YAML on stdin and writes it back with a synthetic Pod appended for
each workload controller found.
"""

from __future__ import annotations

import sys
from typing import Any

import yaml

# Controller kind -> path to its pod template, and a suffix for the synthetic Pod name.
TEMPLATE_PATHS: dict[str, tuple[tuple[str, ...], str]] = {
    "CronJob": (("spec", "jobTemplate", "spec", "template"), "job-pod"),
    "Job": (("spec", "template"), "job-pod"),
    "Deployment": (("spec", "template"), "deploy-pod"),
    "StatefulSet": (("spec", "template"), "sts-pod"),
    "DaemonSet": (("spec", "template"), "ds-pod"),
    "ReplicaSet": (("spec", "template"), "rs-pod"),
}


def _dig(doc: dict[str, Any], path: tuple[str, ...]) -> dict[str, Any] | None:
    node: Any = doc
    for key in path:
        if not isinstance(node, dict) or key not in node:
            return None
        node = node[key]
    return node if isinstance(node, dict) and "spec" in node else None


def _namespace_for(
    owner: dict[str, Any], template: dict[str, Any], fallback: str
) -> str:
    """Resolve a namespace for the synthetic Pod.

    Overlays often omit metadata.namespace because Argo CD applies
    destination.namespace at sync time. Defaulting to "default" would falsely trip
    constraints that forbid the default namespace, so fall back to the Namespace
    declared alongside these manifests, then to identifying labels.
    """
    owner_meta = owner.get("metadata") or {}
    tmpl_meta = template.get("metadata") or {}
    labels = {**(owner_meta.get("labels") or {}), **(tmpl_meta.get("labels") or {})}
    return (
        owner_meta.get("namespace")
        or tmpl_meta.get("namespace")
        or fallback
        or labels.get("name")
        or labels.get("app.kubernetes.io/part-of")
        or labels.get("app.kubernetes.io/name")
        or "default"
    )


def _pod_from(
    owner: dict[str, Any], template: dict[str, Any], suffix: str, fallback_ns: str
) -> dict[str, Any]:
    name = (owner.get("metadata") or {}).get("name", "workload")
    return {
        "apiVersion": "v1",
        "kind": "Pod",
        "metadata": {
            "name": f"{name}-{suffix}",
            "namespace": _namespace_for(owner, template, fallback_ns),
            "labels": (template.get("metadata") or {}).get("labels") or {},
        },
        "spec": template["spec"],
    }


def expand(manifests: str) -> str:
    docs = [d for d in yaml.safe_load_all(manifests) if d]

    namespaces = [
        d["metadata"]["name"]
        for d in docs
        if d.get("kind") == "Namespace" and (d.get("metadata") or {}).get("name")
    ]
    fallback_ns = namespaces[0] if namespaces else ""

    out: list[dict[str, Any]] = []
    for doc in docs:
        out.append(doc)
        entry = TEMPLATE_PATHS.get(doc.get("kind", ""))
        if entry is None:
            continue
        path, suffix = entry
        template = _dig(doc, path)
        if template is not None:
            out.append(_pod_from(doc, template, suffix, fallback_ns))

    # Separators are load-bearing. Concatenated dumps without "---" collapse into a
    # single document where the last root keys win, so gator never sees the synthetic
    # Pods and reports a false PASS.
    return "".join(f"---\n{yaml.dump(d, sort_keys=False)}" for d in out)


def main() -> None:
    print(expand(sys.stdin.read()), end="")


if __name__ == "__main__":
    main()
