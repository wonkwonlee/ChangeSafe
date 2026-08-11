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
# A version already on the registry is only ever trusted when npm recorded it
# as published from the exact commit this run is releasing (`gitHead`) — i.e.
# an earlier, unfinished attempt at *this* release. Any other already-published
# version — hand-published, published from a different commit, or landed by a
# compromised maintainer account before this workflow ran — is refused rather
# than silently treated as satisfied: skipping it would otherwise bless
# whatever is already sitting on the registry under this version number.
#
# Usage: select-unpublished.sh <version> <expected-git-head> <package>...
set -euo pipefail

VERSION="${1:?usage: select-unpublished.sh <version> <expected-git-head> <package>...}"
EXPECTED_GIT_HEAD="${2:?usage: select-unpublished.sh <version> <expected-git-head> <package>...}"
shift 2

for NAME in "$@"; do
  # `npm view` exits non-zero when the exact version does not exist. Any other
  # failure (network, auth) also lands here, which is the safe direction: the
  # package is treated as unpublished and `npm publish` decides for real.
  if ! npm view "$NAME@$VERSION" version >/dev/null 2>&1; then
    echo "$NAME"
    continue
  fi
  PUBLISHED_HEAD=$(npm view "$NAME@$VERSION" gitHead 2>/dev/null || true)
  if [ "$PUBLISHED_HEAD" != "$EXPECTED_GIT_HEAD" ]; then
    echo "::error::$NAME@$VERSION is already on the registry from commit ${PUBLISHED_HEAD:-<unrecorded>}, not this release's $EXPECTED_GIT_HEAD — refusing to treat an unverified prepublished package as satisfied" >&2
    exit 1
  fi
done
