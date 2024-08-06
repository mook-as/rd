load '../helpers/load'

get_tempdir() {
    if ! is_windows; then
        echo "$BATS_TEST_TMPDIR"
        return
    fi
    # On Windows, create a temporary directory that is in the Windows temporary
    # directory so that it mounts correctly.  Note that in CI we end up running
    # with PSModulePath set to pwsh (7.x) paths, and that breaks the code for
    # PowerShell 5.1.  So we need to have alternative code in that case.
    # See also https://github.com/PowerShell/PowerShell/issues/14100
    if command -v pwsh.exe &>/dev/null; then
        # shellcheck disable=SC2016 # Don't expand PowerShell expansion
        local command='
            $([System.IO.Directory]::CreateTempSubdirectory()).FullName
        '
        run pwsh.exe -Command "$command"
        assert_success
    else
        # PowerShell 5.1 is built against .net Framework 4.x and doesn't have
        # [System.IO.Directory]::CreateTempSubdirectory(); create a temporary
        # file and use its name instead.
        # shellcheck disable=SC2016 # Don't expand PowerShell expansion
        local command='
            $name = New-TemporaryFile
            Remove-Item -Path $name
            Start-Sleep -Seconds 1 # Allow anti-virus to do stuff
            New-Item -Type Directory -Path $name | Out-Null
            $name.FullName
        '
        run powershell.exe -Command "$command"
        assert_success
    fi
    run wslpath -u "$output"
    assert_success
    echo "$output" | tr -d "\r"
}

local_setup() {
    unset PSModulePath # On Windows, fix running PowerShell 5.1 within pwsh 7
    run get_tempdir
    assert_success
    export WORK_PATH=$output
}

local_teardown() {
    # Only do manual deletion on Windows; elsewhere we use BATS_TEST_TMPDIR so
    # BATS is expected to do the cleanup.
    if is_windows && [[ -n $WORK_PATH ]]; then
        local host_work_path
        host_work_path=$(host_path "$WORK_PATH")
        powershell.exe -Command "Remove-Item -Recurse -LiteralPath '$host_work_path'"
    fi
}

@test 'factory reset' {
    factory_reset
}

@test 'start container engine' {
    if is_linux; then
        # On linux, mount BATS_RUN_TMPDIR into the VM so that we can use
        # BATS_TEST_TMPDIR as a volume.
        local override_dir="${HOME}/.local/share/rancher-desktop/lima/_config"
        mkdir -p "$override_dir"
        {
            echo "mounts:"
            echo "- location: ${BATS_RUN_TMPDIR}"
            echo "  writable: true"
        } >"$override_dir/override.yaml"
    fi
    start_container_engine
    wait_for_container_engine
}

@test 'read-only volume mount' {
    # Read a file that was created outside the container.
    create_file "$WORK_PATH/foo" <<<hello
    # Use `--separate-stderr` to avoid image pull messages.
    run --separate-stderr \
        ctrctl run --volume "$(host_path "$WORK_PATH"):/mount:ro" \
        "$IMAGE_BUSYBOX" cat /mount/foo
    assert_success
    assert_output hello
}

@test 'read-write volume mount' {
    # Create a file from the container.
    ctrctl run --volume "$(host_path "$WORK_PATH"):/mount:rw" \
        "$IMAGE_BUSYBOX" sh -c 'echo hello > /mount/foo'
    # Check that the file was written to.
    run cat "$WORK_PATH/foo"
    assert_success
    assert_output hello
}

@test 'read-write volume mount as user' {
    # Create a file from within the container.
    ctrctl run --volume "$(host_path "$WORK_PATH"):/mount:rw" \
        --user 1000:1000 "$IMAGE_BUSYBOX" sh -c 'echo hello > /mount/foo'
    run cat "$WORK_PATH/foo"
    assert_success
    assert_output hello
    # Try to append to the file.
    ctrctl run --volume "$(host_path "$WORK_PATH"):/mount:rw" \
        --user 1000:1000 "$IMAGE_BUSYBOX" sh -c 'echo hello | tee -a /mount/foo'
    # Check that the file was modified.
    run cat "$WORK_PATH/foo"
    assert_success
    assert_output hello$'\n'hello
    if is_windows && using_windows_exe; then
        # On Windows, the directory may be owned by a group that the user is in;
        # additionally, there isn't an easy API to get effective access (!?).
        # shellcheck disable=SC2016 # Don't expand PowerShell expansion
        local command='
            $type = [System.Type]::GetType("System.Security.Principal.SecurityIdentifier")
            $owner = $(Get-Acl '"'$host_work_path/foo'"').GetOwner($type)
            $owner.Value
        '
        run powershell.exe -Command "$command"
        assert_success
        local owner=${output//$'\r'/}
        # shellcheck disable=SC2016 # Don't expand PowerShell expansion
        command='
            $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
            $groups = $identity.Groups
            $groups.Add($identity.User)
            $groups | ForEach-Object { $_.Value }
        '
        run powershell.exe -Command "$command"
        assert_success
        assert_line "$owner"
    else
        # Check that the file is owned by the current user.
        stat_arg=-f # Assume BSD stat
        if stat --version | grep 'GNU coreutils'; then
            stat_arg=-c
        fi
        run stat "$stat_arg" '%u:%g' "$WORK_PATH/foo"
        assert_success
        assert_output "$(id -u):$(id -g)"
    fi
}
