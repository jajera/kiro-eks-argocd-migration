#!/usr/bin/env bash
# Install the pinned gator CLI (checksum-verified). Same pin as CI / README.
#
# Usage:
#   scripts/install-gator.sh              # install to /usr/local/bin (needs sudo)
#   scripts/install-gator.sh /path/to/bin # install to directory (must be writable)
#
# Env overrides (optional):
#   GATOR_VERSION  default 3.22.0
#   GATOR_OS       linux|darwin  (auto)
#   GATOR_ARCH     amd64|arm64   (auto)
set -euo pipefail

GATOR_VERSION="${GATOR_VERSION:-3.22.0}"

# SHA-256 of gator-v${VERSION}-${os}-${arch}.tar.gz from
# https://github.com/open-policy-agent/gatekeeper/releases/tag/v3.22.0
declare -A GATOR_SHA256=(
  [linux-amd64]=45ba8c54a22261473bddf6f4f18b154058d45b0c64f3e7a67b2fa781f0791800
  [darwin-amd64]=7018a6a3ab98709323cafa8ec70ff8898980b4223baa676903b07c4fa1e34e43
  [darwin-arm64]=daa060423355aeed00084ea2bad60bd35b29d22b44fecadd95e6ce83e829bcb5
)

detect_os() {
  case "$(uname -s)" in
    Linux*) echo linux ;;
    Darwin*) echo darwin ;;
    *) echo "unsupported OS: $(uname -s)" >&2; exit 1 ;;
  esac
}

detect_arch() {
  case "$(uname -m)" in
    x86_64|amd64) echo amd64 ;;
    aarch64|arm64) echo arm64 ;;
    *) echo "unsupported arch: $(uname -m)" >&2; exit 1 ;;
  esac
}

os="${GATOR_OS:-$(detect_os)}"
arch="${GATOR_ARCH:-$(detect_arch)}"
plat="${os}-${arch}"
sha="${GATOR_SHA256[$plat]:-}"
if [[ -z "$sha" ]]; then
  echo "error: no SHA-256 pin for platform ${plat} (gator ${GATOR_VERSION})" >&2
  exit 1
fi

dest_dir="${1:-/usr/local/bin}"
mkdir -p "$dest_dir"

url="https://github.com/open-policy-agent/gatekeeper/releases/download/v${GATOR_VERSION}/gator-v${GATOR_VERSION}-${plat}.tar.gz"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "Downloading gator v${GATOR_VERSION} (${plat})"
curl -fsSL -o "$tmp/gator.tar.gz" "$url"

if command -v sha256sum >/dev/null 2>&1; then
  echo "${sha}  $tmp/gator.tar.gz" | sha256sum -c -
elif command -v shasum >/dev/null 2>&1; then
  echo "${sha}  $tmp/gator.tar.gz" | shasum -a 256 -c -
else
  echo "error: need sha256sum or shasum" >&2
  exit 1
fi

tar -xzf "$tmp/gator.tar.gz" -C "$tmp" gator
chmod +x "$tmp/gator"

target="${dest_dir}/gator"
if [[ -w "$dest_dir" ]]; then
  mv "$tmp/gator" "$target"
else
  sudo mv "$tmp/gator" "$target"
fi

"$target" version
echo "Installed: $target (gator ${GATOR_VERSION}, ${plat})"
