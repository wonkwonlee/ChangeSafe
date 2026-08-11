#!/usr/bin/env bash
#
# Print the packages that are not yet on the registry at a given version, one
# per line, in the order they were passed. Any package that already has a
# version published — for any reason — fails the run instead.
#
# An earlier version of this script skipped an already-published package
# instead of failing, so a run that died partway through publishing (five
# packages, five separate registry calls) could be resumed by re-running the
# release. That convenience is also exactly the gap a compromised publisher
# or a stray hand-publish needs: nothing here can tell "this package reached
# the registry because an earlier run of *this* release workflow put it
# there" apart from "someone else already published this version number."
# A `gitHead` comparison was tried and removed for the same reason: npm's
# `package.json` normalizer only derives `gitHead` from git when the field
# is absent, so a publisher — compromised or not — can hardcode the real
# release commit into a malicious package.json before publishing (that
# commit is public on an open-source repo anyway), and the check would wave
# it through. That is not verification, only the appearance of it.
#
# Real protection needs npm's signed provenance/attestation (verifiable,
# for example, via `gh attestation verify` against the published tarball),
# not a string comparison — that is future work. Until then, failing closed
# and recovering by hand (see CONTRIBUTING.md) is the honest answer, not an
# automated check a publisher can satisfy by copying a public commit hash.
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
    echo "::error::$NAME@$VERSION is already on the registry, and this script cannot verify who put it there or why. Re-running this workflow will hit the same refusal — it does not resume. Publish the remaining packages by hand instead (see the 'Publishing' section of CONTRIBUTING.md)." >&2
    exit 1
  fi
  echo "$NAME"
done
