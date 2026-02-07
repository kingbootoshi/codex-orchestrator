#!/bin/bash
# codex-agent WSL bridge - Routes commands through WSL with path conversion
# Converts Windows paths (Git Bash, CMD, PowerShell) to WSL /mnt/ format

convert_win_to_wsl() {
    local win_path="$1"
    if [[ "$win_path" =~ ^/([a-zA-Z])/ ]]; then
        echo "/mnt/${BASH_REMATCH[1],,}/${win_path:3}"
    elif [[ "$win_path" =~ ^([a-zA-Z]):\\ ]]; then
        local drive="${win_path:0:1}"
        drive="${drive,,}"
        local rest="${win_path:3}"
        rest="${rest//\\//}"
        echo "/mnt/${drive}/${rest}"
    elif [[ "$win_path" =~ ^([a-zA-Z]):/ ]]; then
        local drive="${win_path:0:1}"
        drive="${drive,,}"
        echo "/mnt/${drive}/${win_path:3}"
    else
        echo "$win_path"
    fi
}

ARGS=()
SKIP_NEXT=false

for i in "$@"; do
    if $SKIP_NEXT; then
        SKIP_NEXT=false
        ARGS+=("$(convert_win_to_wsl "$i")")
        continue
    fi
    case "$i" in
        -d|--dir|-f|--file)
            ARGS+=("$i")
            SKIP_NEXT=true
            ;;
        *)
            ARGS+=("$i")
            ;;
    esac
done

WSL_CWD="$(convert_win_to_wsl "$(pwd)")"

wsl -e bash -lc "cd '${WSL_CWD}' 2>/dev/null; export PATH=\"\$HOME/.bun/bin:\$HOME/.codex-orchestrator/bin:\$PATH\"; codex-agent ${ARGS[*]}"
