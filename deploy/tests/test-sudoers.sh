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

for rule in '/usr/sbin/ip addr add \* dev \*' '/usr/sbin/ip addr del \* dev \*' '/usr/bin/nmcli \*' '/usr/sbin/pppd \*'; do
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

[ "$FAILS" -eq 0 ] && echo "all passed" || { echo "$FAILS failed"; exit 1; }
