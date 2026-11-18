#!/bin/bash
# Moves flightlogs/ and media/ into the logs/ layout. Existing files are never overwritten.
set -eu
ETC="${RPANION_ETC_DIR:-/etc/rpanion-server}"
LOGS="$ETC/logs"

mkdir -p "$LOGS/telemetry" "$LOGS/bin" "$LOGS/kmz" "$LOGS/terminal" "$LOGS/media"

# move_files SRC DST [find args...]: moves matching files, keeping the relative path
move_files() {
    local src="$1" dst="$2" f rel
    shift 2
    [ -d "$src" ] || return 0
    while IFS= read -r -d '' f; do
        rel="${f#"$src"/}"
        mkdir -p "$dst/$(dirname "$rel")"
        mv -n "$f" "$dst/$rel"
    done < <(find "$src" -type f "$@" -print0)
}

if [ -d "$ETC/flightlogs" ]; then
    move_files "$ETC/flightlogs/kmzlogs" "$LOGS/kmz"
    # Only the top level: telemetry and bin files were written directly into flightlogs/
    for f in "$ETC"/flightlogs/*.tlog; do [ -e "$f" ] && mv -n "$f" "$LOGS/telemetry/"; done
    for f in "$ETC"/flightlogs/*.bin; do [ -e "$f" ] && mv -n "$f" "$LOGS/bin/"; done
    find "$ETC/flightlogs" -depth -type d -empty -delete
fi

if [ -d "$ETC/media" ]; then
    move_files "$ETC/media" "$LOGS/media"
    find "$ETC/media" -depth -type d -empty -delete
fi

exit 0
