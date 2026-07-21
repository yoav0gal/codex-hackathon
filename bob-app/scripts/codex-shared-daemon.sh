#!/bin/zsh

set -euo pipefail

codex_bin="${BOB_CODEX_BIN:-$(command -v codex || true)}"
desktop_app="${BOB_CODEX_DESKTOP_APP:-/Applications/ChatGPT.app}"
desktop_executable="$desktop_app/Contents/MacOS/ChatGPT"
action="${1:-prepare}"
codex_root="${CODEX_HOME:-$HOME/.codex}"
control_socket="$codex_root/app-server-control/app-server-control.sock"

if [[ -z "$codex_bin" || ! -x "$codex_bin" ]]; then
  print -u2 "Codex CLI not found. Set BOB_CODEX_BIN to its absolute path."
  exit 1
fi

desktop_is_running() {
  ps -axo command= | grep -Fx "$desktop_executable" >/dev/null
}

desktop_pid() {
  ps -axo pid=,command= | awk -v executable="$desktop_executable" '
    index($0, executable) {
      line = $0
      sub(/^[[:space:]]*/, "", line)
      pid = line
      sub(/[[:space:]].*$/, "", pid)
      command = line
      sub(/^[^[:space:]]+[[:space:]]+/, "", command)
      if (command == executable) {
        print pid
        exit
      }
    }
  '
}

desktop_uses_shared_daemon() {
  local pid
  pid="$(desktop_pid)"
  [[ -n "$pid" ]] || return 1
  ps eww -p "$pid" -o command= | perl -ne '
    $found = 1 if /(?:^| )CODEX_APP_SERVER_USE_LOCAL_DAEMON=1(?: |$)/;
    END { exit($found ? 0 : 1) }
  '
}

desktop_has_private_app_servers() {
  ps -axo command= | awk -v expected="$desktop_app/Contents/Resources/codex app-server --listen stdio://" '
    $0 == expected { found = 1 }
    END { exit(found ? 0 : 1) }
  '
}

check_desktop() {
  if ! desktop_is_running; then
    print -u2 "Codex Desktop is not running on the shared daemon. Run: npm run codex:launch"
    return 3
  fi
  if ! desktop_uses_shared_daemon || desktop_has_private_app_servers; then
    print -u2 "Codex Desktop is running on private app-server processes, so Bob delegations cannot appear live."
    print -u2 "Quit Codex Desktop normally, then run: npm run codex:launch"
    return 3
  fi
  print "Codex Desktop is connected to Bob's shared managed daemon."
}

ensure_daemon() {
  "$codex_bin" app-server daemon start
  for _attempt in {1..20}; do
    [[ -S "$control_socket" ]] && return
    sleep 0.1
  done
  print -u2 "Codex did not create its managed socket at $control_socket."
  exit 1
}

case "$action" in
  prepare)
    ensure_daemon
    "$codex_bin" app-server daemon version
    if desktop_is_running; then
      print "The running Codex Desktop was left untouched. Quit it normally, then run: npm run codex:launch"
    else
      print "The daemon is ready. Run: npm run codex:launch"
    fi
    ;;
  launch)
    if desktop_is_running; then
      print -u2 "Codex Desktop is already running. Quit it normally, then retry."
      exit 2
    fi
    if [[ ! -d "$desktop_app" ]]; then
      print -u2 "Codex Desktop was not found at $desktop_app. Set BOB_CODEX_DESKTOP_APP."
      exit 1
    fi
    ensure_daemon
    open --env CODEX_APP_SERVER_USE_LOCAL_DAEMON=1 -a "$desktop_app"
    for _attempt in {1..50}; do
      if desktop_is_running && desktop_uses_shared_daemon && ! desktop_has_private_app_servers; then
        print "Launched Codex Desktop against Bob's shared managed daemon."
        exit 0
      fi
      sleep 0.1
    done
    print -u2 "Codex Desktop launched, but it did not join Bob's shared daemon."
    exit 3
    ;;
  status)
    "$codex_bin" app-server daemon version
    check_desktop
    ;;
  stop)
    if desktop_is_running; then
      print -u2 "Codex Desktop is running; refusing to stop a daemon it may be using."
      exit 2
    fi
    "$codex_bin" app-server daemon stop
    ;;
  *)
    print -u2 "Usage: $0 {prepare|launch|status|stop}"
    exit 2
    ;;
esac
