#!/bin/sh
# NetworkManager dispatcher: adds secondary IPv4 addresses from
# /etc/default/rpanion-eth-alias when an Rpanion Ethernet profile comes up.
# The config file is writable by the rpanion user, so it is parsed as data
# and every entry must be a literal a.b.c.d/nn; it is never sourced.

IFACE="$1"
ACTION="$2"
CONFIG_FILE="${RPANION_ALIAS_CONFIG:-/etc/default/rpanion-eth-alias}"

[ "$ACTION" = "up" ] || exit 0

case "$CONNECTION_ID" in
    Ethernet-Client|Ethernet-Server) ;;
    *) exit 0 ;;
esac

[ -f "$CONFIG_FILE" ] || exit 0

valid_entry() {
    printf '%s\n' "$1" | grep -Eq '^([0-9]{1,3}\.){3}[0-9]{1,3}/([0-9]|[12][0-9]|3[0-2])$' || return 1
    ADDR=${1%/*}
    OLD_IFS=$IFS
    IFS=.
    # shellcheck disable=SC2086
    set -- $ADDR
    IFS=$OLD_IFS
    for octet in "$@"; do
        [ "$octet" -le 255 ] || return 1
    done
    return 0
}

ALIASES=$(sed -n 's/^ETH_ALIASES="\([^"]*\)"$/\1/p' "$CONFIG_FILE" | head -n 1)

# Disable globbing: entries come from a user-writable file
set -f
for entry in $ALIASES; do
    valid_entry "$entry" || continue
    if [ -n "$RPANION_DRY_RUN" ]; then
        echo "ip addr add $entry dev $IFACE"
    else
        ip addr add "$entry" dev "$IFACE" 2>/dev/null || true
    fi
done
