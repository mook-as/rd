#!/bin/bash

# This script expects to be called from the root of the repo.
# It will rebuild resources/k3s-versions.json from both the k3s update
# channel and the GitHub k3s releases list.
# Creates a pull request if the new version is different.

set -eu

K3S_VERSIONS="resources/k3s-versions.json"
BRANCH_NAME="gha-update-k3s-versions"
NEW_PR="true"

if git rev-parse --verify "origin/${BRANCH_NAME}" 2>/dev/null; then
    # This logic relies on the fact that PR branches inside the repo get automatically
    # deleted when the PR has been merged. We assume that if the branch exists, there
    # is also a corresponding PR for it, so we just update the branch with a new commit.
    git checkout "$BRANCH_NAME"
    NEW_PR="false"
else
    git checkout -b "$BRANCH_NAME"
fi

CHANNELS=$(jq '[.data.[] | select(.name | test("^(stable|latest|v1\\.(2[1-9]|[3-9][0-9]+))$"))] | reduce .[] as $ch ({}; .[$ch.name] = ($ch.latest | scan("^[^+]+") | ltrimstr("v")))' <(curl -s https://update.k3s.io/v1-release/channels))

VERSIONS=$(gh api /repos/k3s-io/k3s/releases --paginate --jq '.[] | select((.draft|not) and (.prerelease|not)) | .tag_name')
VERSIONS=$(grep -E '^v1\.(2[1-9]|[3-9][0-9]+)\.[0-9]+\+k3s[0-9]+$' <<<"$VERSIONS" | sort -V -r | sort -V -u -k1,1 -t+ | jq --null-input --raw-input '[inputs]')

echo '{"cacheVersion": 2}' | jq --sort-keys --argjson channels "$CHANNELS" --argjson versions "$VERSIONS" '.channels = $channels | .versions = $versions' >"$K3S_VERSIONS"

# Exit if there are no changes
git diff --exit-code && exit

export GIT_AUTHOR_NAME="Rancher Desktop GitHub Action"
export GIT_AUTHOR_EMAIL="donotuse@rancherdesktop.io"
git add "$K3S_VERSIONS"
git commit --signoff --message "Automated update: k3s-versions.json"
git push origin "$BRANCH_NAME"

test "$NEW_PR" = "false" && exit

gh pr create \
    --title "Update k3s-versions.json" \
    --body "This pull request contains the latest update to k3s-versions.json." \
    --head "$BRANCH_NAME" \
    --base main
