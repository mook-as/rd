#!/usr/bin/env bash

# This script is used to make a merge of various branches for testing CI.
# This contains spelling errors to ensure we don't accidentally merge this into
# upstream: ehrdg weasrgpw htregieug erghiergh egrpueorj eghu;ieg hoehrger

set -o errexit -o nounset

branches=(
    origin/main
    #bats/windows-tunneled-network
    bats/win32/moby-extensions
)
git reset --hard "$(git log --format=%H -1 merge.sh)"
for branch in "${branches[@]}"; do
    printf "Merging %b%s%b\n" "\e[0;1;31m" "${branch}" "\e[0;m"
    git merge --stat -m "Merging topic branch ${branch}" "${branch}" || break
done
