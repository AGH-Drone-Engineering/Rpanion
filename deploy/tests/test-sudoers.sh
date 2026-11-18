#!/bin/bash
# Checks the sudoers fragment written by debian/postinst.
set -u
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
POSTINST="$DIR/../../debian/postinst"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
FAILS=0

sed -n "/<<'EOF'/,/^EOF$/p" "$POSTINST" | sed '1d;$d' > "$TMP/sudoers"

if sudo visudo -cf "$TMP/sudoers" >/dev/null; then
    echo "ok   - sudoers syntax valid"
else
    echo "FAIL - sudoers syntax invalid"; FAILS=$((FAILS + 1))
fi

if grep -Eq '/ip \*' "$TMP/sudoers"; then
    echo "FAIL - unrestricted ip rule present"; FAILS=$((FAILS + 1))
else
    echo "ok   - no unrestricted ip rule"
fi

if grep -Eq 'rpanion-system *(,|$)' "$TMP/sudoers"; then
    echo "FAIL - rpanion-system allowed with arbitrary arguments"; FAILS=$((FAILS + 1))
else
    echo "ok   - rpanion-system limited to explicit subcommands"
fi

for rule in '/usr/sbin/ip addr add \* dev \*' '/usr/sbin/ip addr del \* dev \*' '/usr/bin/nmcli \*' '/usr/sbin/pppd \*' '/usr/local/sbin/rpanion-system hostname \*' '/usr/local/sbin/rpanion-system sshpassword' '/usr/bin/systemctl start rpanion-terminal' '/usr/bin/systemctl stop --no-block rpanion-terminal' '\(#1000\) NOPASSWD: /usr/bin/tmux -N -S /run/rpanion-terminal/tmux.sock \*$'; do
    if grep -Eq "$rule" "$TMP/sudoers"; then
        echo "ok   - rule present: $rule"
    else
        echo "FAIL - rule missing: $rule"; FAILS=$((FAILS + 1))
    fi
done

if grep -q 'visudo -cf' "$POSTINST"; then
    echo "ok   - postinst validates before install"
else
    echo "FAIL - postinst installs sudoers without visudo check"; FAILS=$((FAILS + 1))
fi

# Fragment written by deploy/configure_system.sh (image builds)
CONFIGURE="$DIR/../configure_system.sh"
sed -n "/<<'SUDOERS'/,/^SUDOERS$/p" "$CONFIGURE" | sed '1d;$d' > "$TMP/sudoers-configure"
if sudo visudo -cf "$TMP/sudoers-configure" >/dev/null; then
    echo "ok   - configure_system.sh sudoers syntax valid"
else
    echo "FAIL - configure_system.sh sudoers syntax invalid"; FAILS=$((FAILS + 1))
fi
for rule in 'systemctl start rpanion-terminal' 'systemctl stop --no-block rpanion-terminal' '\(#1000\) NOPASSWD: /usr/bin/tmux -N -S /run/rpanion-terminal/tmux.sock \*$'; do
    if grep -Eq "$rule" "$TMP/sudoers-configure"; then
        echo "ok   - configure_system.sh rule present: $rule"
    else
        echo "FAIL - configure_system.sh rule missing: $rule"; FAILS=$((FAILS + 1))
    fi
done

# Unit files, with the installed paths pointed at the repository copies
if command -v systemd-analyze >/dev/null; then
    DEPLOY="$(cd "$DIR/.." && pwd)"
    for unit in rpanion-terminal.service; do
        sed -e "s#/usr/local/lib/rpanion-terminal/stop.sh#$DEPLOY/rpanion-terminal-stop.sh#" \
            -e "s#/usr/local/sbin/rpanion-system#$DIR/../../server/rpanion-system.sh#" "$DEPLOY/$unit" > "$TMP/$unit"
        if systemd-analyze verify --man=no "$TMP/$unit" 2>"$TMP/verify.err"; then
            echo "ok   - systemd-analyze verify $unit"
        else
            cat "$TMP/verify.err"; echo "FAIL - systemd-analyze verify $unit"; FAILS=$((FAILS + 1))
        fi
    done
fi

[ "$FAILS" -eq 0 ] && echo "all passed" || { echo "$FAILS failed"; exit 1; }
