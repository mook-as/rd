#!/usr/bin/env bash

# This script is used to make a merge of various branches for testing CI.
# This contains spelling errors to ensure we don't accidentally merge this into
# upstream: ehrdg weasrgpw htregieug erghiergh egrpueorj eghu;ieg hoehrger

set -o errexit -o nounset

branches=(
    origin/main
    scripts/rddepman/only-same-repo
    bats/profile/windows-paths
    bats/windows-no-create-from-wsl/roaming-prefs
    bats/windows-no-create-from-wsl/containerd-shims
    bats/autostart/windows-exe-unpacked
    rdctl/factory-reset-windows/no-docker-context
    rddepman/wix/binaries-patch-version
    ci/screenshots
    e2e/startSlowerDesktop-returns
    e2e/use-default-memory
    ci/merge-releases
    bats/snapshot-delete-all-check
)
git reset --hard "$(git log --format=%H -1 merge.sh)"
for branch in "${branches[@]}"; do
    printf "Merging %b%s%b\n" "\e[0;1;31m" "${branch}" "\e[0;m"
    git merge --stat -m "Merging topic branch ${branch}" "${branch}" || break
done
