#!/usr/bin/env bash
#
# Print the packages that are not yet on the registry at a given version, one
# per line, in the order they were passed.
#
# Publishing the workspace is five separate registry calls, so a failure
# partway through leaves some packages live and the rest missing. This decides
# what a resumed run still has to do. It is a separate script rather than
# inline YAML so it can be tested: the selection is the part where a mistake is
# silent — skipping a package that was never published produces an incomplete
# release that still reports success.
#
# Any already-published version fails the run rather than being treated as
# satisfied. A `gitHead` comparison was tried here and removed: npm's
# `package.json` normalizer only derives `gitHead` from git when the field is
# absent, so a publisher can simply hardcode the real release commit into a
# malicious package.json before publishing — a value that is public anyway
# on an open-source repo — and the check would wave it through. That is not
# verification, only the appearance of it. Real protection needs npm's signed
# provenance/attestation, which this script does not attempt; until it does,
# a human deciding whether an existing publish is trustworthy is the honest
# answer, not an automated check that can be satisfied by copying a public
# commit hash into a manifest.
#
# Usage: select-unpublished.sh <version> <package>...
set -euo pipefail

VERSION="${1:?usage: select-unpublished.sh <version> <package>...}"
shift

for NAME in "$@"; do
  # `npm view` exits non-zero when the exact version does not exist. Any other
  # failure (network, auth) also lands here, which is the safe direction: the
  # package is treated as unpublished and `npm publish` decides for real.
  if npm view "$NAME@$VERSION" version >/dev/null 2>&1; then
    echo "::error::$NAME@$VERSION is already on the registry. This script cannot verify it came from this workflow, so it refuses rather than silently treating it as done — confirm by hand, then retry." >&2
    exit 1
  fi
  echo "$NAME"
done
