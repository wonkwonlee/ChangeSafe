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
# Usage: select-unpublished.sh <version> <package>...
set -euo pipefail

VERSION="${1:?usage: select-unpublished.sh <version> <package>...}"
shift

for NAME in "$@"; do
  # `npm view` exits non-zero when the exact version does not exist. Any other
  # failure (network, auth) also lands here, which is the safe direction: the
  # package is treated as unpublished and `npm publish` decides for real.
  if npm view "$NAME@$VERSION" version >/dev/null 2>&1; then
    continue
  fi
  echo "$NAME"
done
