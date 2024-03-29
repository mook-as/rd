delete_all_snapshots() {
    run rdctl snapshot list --json
    assert_success
    jq_output .name | while IFS= read -r name; do
        rdctl snapshot delete "$name" </dev/null
    done
    run rdctl snapshot list
    assert_success
    assert_output --partial 'No snapshots'
}
