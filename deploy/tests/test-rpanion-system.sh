#!/bin/bash
# Checks server/rpanion-system.sh with stubbed system commands; no root needed.
set -u
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HELPER="$DIR/../../server/rpanion-system.sh"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
FAILS=0

ok()   { echo "ok   - $1"; }
fail() { echo "FAIL - $1"; FAILS=$((FAILS + 1)); }
check() { if [ "$2" = "$3" ]; then ok "$1"; else fail "$1 (expected '$3', got '$2')"; fi; }

mkdir -p "$TMP/bin"

# State lives in files under $TMP/state; FAIL_* variables inject failures
cat > "$TMP/bin/hostnamectl" <<'EOF'
#!/bin/bash
[ "${FAIL_HOSTNAMECTL:-}" = 1 ] && exit 1
[ "$1" = set-hostname ] && echo "$2" > "$STATE/hostname"
EOF
cat > "$TMP/bin/hostname" <<'EOF'
#!/bin/bash
cat "$STATE/hostname"
EOF
cat > "$TMP/bin/nmcli" <<'EOF'
#!/bin/bash
echo "$*" >> "$STATE/nmcli.log"
[ -f "$STATE/ap_ssid" ] || { [ "$1" = -g ] && exit 10; }
case "$*" in
    "-g connection.id connection show WiFiAP") echo WiFiAP ;;
    "-g 802-11-wireless.ssid connection show WiFiAP") cat "$STATE/ap_ssid" ;;
    "-g GENERAL.STATE connection show WiFiAP") cat "$STATE/ap_state" ;;
    "connection modify WiFiAP 802-11-wireless.ssid "*)
        [ "${FAIL_NMCLI_MODIFY:-}" = 1 ] && [ "$5" != "$(cat "$STATE/ssid_before")" ] && exit 1
        echo "$5" > "$STATE/ap_ssid" ;;
esac
EOF
cat > "$TMP/bin/systemctl" <<'EOF'
#!/bin/bash
case "$*" in
    "is-active --quiet avahi-daemon") [ "${AVAHI_ACTIVE:-1}" = 1 ] ;;
    "restart avahi-daemon")
        echo restart >> "$STATE/avahi.log"
        [ "${FAIL_AVAHI:-}" = 1 ] && [ "$(cat "$STATE/hostname")" != "$(cat "$STATE/hostname_before")" ] && exit 1
        exit 0 ;;
esac
EOF
cat > "$TMP/bin/systemd-run" <<'EOF'
#!/bin/bash
echo "$*" >> "$STATE/systemd-run.log"
EOF
chmod +x "$TMP/bin/"*

# setup <hostname> <ap: none|inactive|active>
setup() {
    export STATE="$TMP/state"
    rm -rf "$STATE"; mkdir -p "$STATE"
    echo "$1" > "$STATE/hostname"; echo "$1" > "$STATE/hostname_before"
    printf '127.0.0.1 localhost\n127.0.1.1 %s %s\n' "$1" "$1" > "$STATE/hosts"
    cp "$STATE/hosts" "$STATE/hosts_before"
    if [ "$2" != none ]; then
        echo "$1" > "$STATE/ap_ssid"; echo "$1" > "$STATE/ssid_before"
        [ "$2" = active ] && echo activated > "$STATE/ap_state" || echo "" > "$STATE/ap_state"
    fi
}

run() {
    PATH="$TMP/bin:$PATH" RPANION_HOSTS_FILE="$STATE/hosts" RPANION_LOCK_FILE="$STATE/lock" \
        bash "$HELPER" "$@" >"$STATE/out" 2>&1
}

# Success with an active AP
setup rpanion active
run hostname rpanion-07 --ap; check "rename exits 0" "$?" 0
check "hostname set" "$(cat "$STATE/hostname")" rpanion-07
check "hosts entry updated" "$(grep '^127.0.1.1' "$STATE/hosts")" "127.0.1.1 rpanion-07 rpanion-07"
check "localhost line kept" "$(grep -c '^127.0.0.1 localhost$' "$STATE/hosts")" 1
check "AP SSID follows name" "$(cat "$STATE/ap_ssid")" rpanion-07
check "avahi restarted" "$(wc -l < "$STATE/avahi.log")" 1
grep -q "on-active=3 /usr/bin/nmcli connection up WiFiAP" "$STATE/systemd-run.log" 2>/dev/null \
    && ok "active AP re-activation scheduled" || fail "active AP re-activation scheduled"

# Inactive AP: SSID changed, no re-activation
setup rpanion inactive
run hostname drone-2 --ap; check "inactive AP: exits 0" "$?" 0
check "inactive AP: SSID changed" "$(cat "$STATE/ap_ssid")" drone-2
[ -f "$STATE/systemd-run.log" ] && fail "inactive AP: no re-activation" || ok "inactive AP: no re-activation"

# No AP profile
setup rpanion none
run hostname drone-3 --ap; check "no AP: exits 0" "$?" 0
check "no AP: hostname set" "$(cat "$STATE/hostname")" drone-3

# avahi not running: skipped, not an error
setup rpanion inactive
AVAHI_ACTIVE=0 run hostname drone-4 --ap; check "avahi inactive: exits 0" "$?" 0
[ -f "$STATE/avahi.log" ] && fail "avahi inactive: not restarted" || ok "avahi inactive: not restarted"

# Without --ap the AP profile is not touched
setup rpanion active
run hostname drone-5; check "hostname only: exits 0" "$?" 0
check "hostname only: hostname set" "$(cat "$STATE/hostname")" drone-5
check "hostname only: SSID kept" "$(cat "$STATE/ap_ssid")" rpanion
grep -q "WiFiAP" "$STATE/nmcli.log" 2>/dev/null && fail "hostname only: AP profile not read" || ok "hostname only: AP profile not read"
[ -f "$STATE/systemd-run.log" ] && fail "hostname only: no re-activation" || ok "hostname only: no re-activation"

setup rpanion active
run hostname drone-6 --bogus; check "unknown option exits 64" "$?" 64
check "unknown option: hostname kept" "$(cat "$STATE/hostname")" rpanion

# Rollback when each step fails
for step in HOSTNAMECTL NMCLI_MODIFY AVAHI; do
    setup rpanion active
    export "FAIL_$step=1"
    run hostname drone-9 --ap; rc=$?
    unset "FAIL_$step"
    check "$step failure: exits 1" "$rc" 1
    check "$step failure: hostname restored" "$(cat "$STATE/hostname")" rpanion
    cmp -s "$STATE/hosts" "$STATE/hosts_before" && ok "$step failure: hosts restored" || fail "$step failure: hosts restored"
    check "$step failure: SSID restored" "$(cat "$STATE/ap_ssid")" rpanion
    [ -f "$STATE/systemd-run.log" ] && fail "$step failure: no re-activation" || ok "$step failure: no re-activation"
done

# Invalid names never reach the system
for name in "" Rpanion -x x- a_b localhost 1234 "$(printf 'a%.0s' {1..33})" "a b" "a;reboot"; do
    setup rpanion active
    run hostname "$name"; rc=$?
    if [ "$rc" = 2 ] && [ "$(cat "$STATE/hostname")" = rpanion ] && [ ! -f "$STATE/nmcli.log" ]; then
        ok "rejects '$name'"
    else
        fail "rejects '$name' (exit $rc)"
    fi
done
setup rpanion none
run hostname "$(printf 'a%.0s' {1..32})"; check "accepts 32 characters" "$?" 0
run hostname 7drones; check "accepts digits with letters" "$?" 0

# sshpassword input checks (exit before chpasswd)
setup rpanion none
printf '' | run sshpassword; check "empty password rejected" "$?" 2
printf 'a\tb\n' | run sshpassword; check "control character rejected" "$?" 2

run bogus; check "unknown command exits 64" "$?" 64

[ "$FAILS" -eq 0 ] && echo "all passed" || { echo "$FAILS failed"; exit 1; }
