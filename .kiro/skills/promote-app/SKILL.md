---
name: promote-app
description: Promote a verified app from dev-eks-1 to prod-eks-1 by copying the image digest and confirming prod is healthy. Use when the user asks to promote, ship to prod, roll out to production, or copy a digest from dev to prod.
---

# Promote an app to prod

Promotion is a digest copy, not a rebuild. Prod must run the exact bytes verified on
`dev-eks-1`.

## Preconditions

Confirm before changing anything:

1. Argo CD Application `<app>-dev-eks-1` is `Synced` and `Healthy`.
2. The app reaches its AWS dependencies on dev.
3. Health / readiness checks pass on the new endpoint (if it serves traffic).
4. `apps/<app>/overlays/prod-eks-1/` already exists (every app has both overlays).

If any precondition fails, stop. Do not promote a broken digests.

## Steps

1. Read the pinned image from the dev overlay (the single pin file, usually
   `deployment-patch.yaml` or `cronjob-patch.yaml`):

   ```text
   111122223333.dkr.ecr.ap-southeast-2.amazonaws.com/<app>:<tag>@sha256:<digest>
   ```

2. Apply `apps/<app>/iam.tf` for `prod-eks-1` if the prod Pod Identity association or
   policy is not already in place.

3. Copy that exact image string into the matching prod overlay pin file. Change nothing
   else in the same commit unless prod genuinely needs a different secret path or
   hostname — those are separate from promotion.

4. Open a PR whose diff is ideally one line (the digest). Wait for CI (`kustomize-build`
   and the hygiene workflows).

5. After merge, confirm Argo CD Application `<app>-prod-eks-1` is `Synced` and
   `Healthy`, and the health endpoint responds if applicable.

## Do not

- Rebuild or retag the image during promotion.
- Create the prod overlay at promotion time — it must already exist.
- Promote while digests differ for reasons other than the intended bump.
- Skip applying prod IAM when the association is missing.

## Rollback of a bad promotion

If prod is unhealthy after the digest lands:

1. Revert the PR (or copy the previous prod digest back).
2. Confirm `<app>-prod-eks-1` returns to Healthy.
3. Leave `dev-eks-1` alone — it stays on the new digest for further debugging.
