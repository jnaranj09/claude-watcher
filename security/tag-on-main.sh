#!/usr/bin/env bash
# The release job's first check (docs/threat-model.md T-C8): refuse a tag whose commit is not on
# the main branch. Fails closed: a failed fetch or an unknown commit is a refusal, never a pass.
#   security/tag-on-main.sh <commit> [remote] [branch]
set -euo pipefail

commit="${1:?usage: tag-on-main.sh <commit> [remote] [branch]}"
remote="${2:-origin}"
branch="${3:-main}"

if ! git fetch --quiet --no-tags "$remote" "+refs/heads/$branch:refs/remotes/$remote/$branch"; then
  echo "::error::tag-on-main: could not fetch $remote/$branch; refusing the release" >&2
  exit 1
fi
if ! git cat-file -e "$commit^{commit}" 2>/dev/null; then
  echo "::error::tag-on-main: $commit is not a commit here (shallow clone?); refusing" >&2
  exit 1
fi
if ! git merge-base --is-ancestor "$commit" "$remote/$branch"; then
  echo "::error::tag-on-main: $commit is not on $remote/$branch; refusing the release" >&2
  exit 1
fi
echo "tag-on-main: $commit is on $remote/$branch"
