#!/bin/bash

set -e
set -x

# this script sets up the wifi access point

APNAME="WiFiAP"
SSID="rpanion"
KEY="rpanion123"
IFNAME=wlan0

# Re-running must not create a second WiFiAP profile (looked up by name) or
# switch wlan0 away from a client network
if nmcli connection show "$APNAME" >/dev/null 2>&1; then
    echo "$APNAME exists, leaving it unchanged"
    exit 0
fi

# WPA2-only CCMP, WPS disabled; started on demand by the watchdog, so no autoconnect
sudo nmcli connection add type wifi ifname "$IFNAME" con-name "$APNAME" \
    802-11-wireless.ssid "$SSID" \
    802-11-wireless.mode ap \
    802-11-wireless.band bg \
    ipv4.method shared ipv4.addresses 10.0.2.100/24 \
    802-11-wireless-security.key-mgmt wpa-psk \
    802-11-wireless-security.psk "$KEY" \
    802-11-wireless-security.proto rsn \
    802-11-wireless-security.group ccmp \
    802-11-wireless-security.pairwise ccmp \
    802-11-wireless-security.wps-method 1 \
    connection.autoconnect no \
    connection.autoconnect-priority 0

sudo nmcli connection up "$APNAME"
