<div align="left">

![Build Status](https://github.com/stephendade/Rpanion-server/actions/workflows/unitests.yml/badge.svg)![Package Status](https://github.com/stephendade/Rpanion-server/actions/workflows/package.yml/badge.svg)![Coverage Status](https://coveralls.io/repos/github/stephendade/Rpanion-server/badge.svg)

</div>

User Documentation is at https://www.docs.rpanion.com/software/rpanion-server

<p float="left">
<img src="https://raw.githubusercontent.com/stephendade/Rpanion-server/master/images/controller.png" width="200">
<img src="https://raw.githubusercontent.com/stephendade/Rpanion-server/master/images/network.png" width="200">
<img src="https://raw.githubusercontent.com/stephendade/Rpanion-server/master/images/video.png" width="200">
</p>

# Rpanion-server

This is a node.js based server for companion computers used in Mavlink-based vehicles (ie Ardupilot, PX4).

It presents a web-based interface (running on the companion computer), where system settings such as network,
telemetry and video streaming can be configured from.

Other functions such as log file management, NTRIP input and PPP connections are also supported.

## Supported Boards

| Board | Compatible OS |
|-------|--------------|
| Raspberry Pi 3B or later| Raspberry Pi OS, Ubuntu 22.04 LTS |
| Nvidia Jetson Orin | Ubuntu 22.04 LTS |
| Orange Pi Zero 3 | Ubuntu 24.04 LTS |
| Libre Computer Le Potato | Raspberry Pi OS |

On the [Libre Computer Le Potato](https://libre.computer/products/aml-s905x-cc/), Rpanion-server is compatible with their flavor of [Raspberry Pi OS](https://distro.libre.computer/ci/raspbian/).

> [!NOTE]
> Some users may have issues connecting to the UART on the Raspberry Pi 3B+. Further details and configuration fixes are at https://github.com/stephendade/Rpanion-server/issues/215#issuecomment-2049058406.

> [!NOTE]
> For the Raspberry Pi CM4, Wifi AP performance is typically poor when using the
> internal antenna. It is recommended to use an external antenna. Additionally
> any CSI cameras will not be autodetected. See [here](https://forums.raspberrypi.com/viewtopic.php?t=352540) for more details.


## Features

Rpanion-server allows the user to configure:

- Flight Controller telemetry routing to udp outputs
- Video Streaming via an RTSP server
- Network configuration
- NTRIP Streaming
- Logging (tlog and bin logs)

## Installing

Rpanion-server has pre-built debian packges for arm64 platforms (Jetson, Raspberry Pi, etc). This
is the easiest way to get started. The packages are available from the "Releases" page.

### Disk Images

There are full disk images with a pre-configured Wifi hotspot for the Raspberry Pi. These
are on the "releases" page

### Installation from deb package

This method installs rpanion-server (and pre-requisities) on an existing system.

First install the required packages:

```
sudo apt install -y gstreamer1.0-plugins-good libgstrtspserver-1.0-0 gir1.2-gst-rtsp-server-1.0 
sudo apt install -y gstreamer1.0-plugins-base-apps gstreamer1.0-plugins-ugly gstreamer1.0-plugins-bad
sudo apt install -y network-manager python3 python3-gst-1.0 python3-pip dnsmasq git jq iw avahi-daemon
sudo apt install -y python3-lxml python3-numpy gpsbabel zip python3-dev gstreamer1.0-x ppp python3-venv
sudo apt install -y python3-opencv v4l-utils python3-setuptools
```

If running on RasPiOS, install the libcamera drivers:

```
sudo apt install -y gstreamer1.0-libcamera python3-picamera2 python3-libcamera python3-kms++
```

If running on a NVIDIA Jetson Orin, install the hardware accelerated gstreamer packages:
```
sudo apt install -y nvidia-l4t-gstreamer
```

Install Nodejs (from https://deb.nodesource.com/):
```
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo bash -
sudo apt-get install -y nodejs
```


To (optionally) use the Zerotier and/or Wireguard VPN's, install as follows:

```
curl -s https://install.zerotier.com | sudo bash
sudo apt install wireguard wireguard-tools
```

Download Rpanion-server from the releases page, then install Rpanion-server:
```
wget https://github.com/stephendade/Rpanion-server/releases/download/v1.0.0/rpanion-server_1.0.0_arm64.deb
sudo dpkg -i rpanion-server_1.0.0_arm64.deb
```

For device-specific configurations, see the ``./deploy`` folder for Jetson, X86 and Raspberry Pi (RasPiOS and Ubuntu) scripts.

After installation, Rpanion-server will be available at http://<device_ip>:3001

### Raspberry Pi notes

The Raspberry Pi Zero W(1) and Raspberry Pi 2 are not supported from version 0.10.0 onwards.

Note the CSI camera does not currently work on Ubuntu 22.04 and 24.04, due to incompatibilities with the Raspberry Pi.

Note the GPIO UARTs are not currently working with Ubuntu 24.04.

Ubuntu 24 requires a workaround to install ``python3-dev`` due to package versioning issues:
```
sudo apt install zlib1g=1:1.3.dfsg-3.1ubuntu2 zlib1g-dev=1:1.3.dfsg-3.1ubuntu2
```

If an older version of the Raspberry Pi OS is used (Buster, V10 or below), the ``gst-rpicamsrc`` Gstreamer element
must be installed. See https://github.com/thaytan/gst-rpicamsrc for install instructions.

### Libre Computer AML-S905X-CC aka 'Le Potato' notes

If using a usb to serial converter, you might need to modify permissions of the device.

**Temporary device permission update**

```
sudo chmod 666 /dev/ttyACM0
```

**Persistent device permission update**

Follow the steps on this site for your specific device:
https://www.xmodulo.com/change-usb-device-permission-linux.html

## Building and Running in development mode

Follow the scripts in the ``/deploy`` folder for your selected platform to set up the
development environment.

Then run the ``devExtras.sh`` file to download a compiled ``mavlink-router`` binary.

Running in development mode allows for any code changes to trigger a restart of Rpanion-server. 

Rpanion-server consists of a node.js server running on port 3001 and a React frontend application
running on port 3000 in development mode. 

Run both applications (front and back end) together, use the command:

```bash
npm run dev
```

It is important to *only* use ``npm run dev`` during development, as it will skip
the user login and authentication checks.

At this point, the website will be active at ``http://<ip of device>:3000``

## Packaging

To produce a deb package, run ``npm run build && npm run package``.

## Default username and password

Rpanion-server has access control in place to prevent unauthorised users from
making changes to the system via the GUI.

The access control does *not* apply to any MAVLink or video streams

The default username is ``admin`` and password ``admin``. This can be changed
on the "Device Settings" page.

Usernames and passwords are stored in the ``user.json`` file in the Rpanion-server folder. Resetting this file (via ``git checkout user.json``)
will reset the usernames/passwords back to it's defaults.

If Rpanion-server runs in a trusted network or you ensure access control by other means, you can choose to disable the built-in access control by setting an environment variable `DISABLE_AUTH=1` on the node process, e.g. in the systemd `rpanion-server.service`.

## Device name and SSH password

Rpanion images ship with the device name ``rpanion`` (reachable as ``rpanion.local``), SSH user ``pi`` with the
password from the image, and the Web GUI user ``admin``/``admin``. The "Device Settings" page changes:

- the device name: hostname and mDNS name (``<name>.local``). On saving, the page asks whether to set the
  SSID of the ``WiFiAP`` access point to the same name (recommended).
  1-32 characters, lowercase letters, digits and hyphens, not only digits, not ``localhost``.
  The change is applied as a whole or rolled back. An active access point restarts with the new SSID
  a few seconds later, which disconnects its clients.
- the SSH password of user ``pi`` (8-64 characters)
- the Web GUI users

Give each drone on the same network its own name. Two drones that both still use ``rpanion`` are renamed
by mDNS to ``rpanion.local`` and ``rpanion-2.local`` in start-up order. Configure new drones one at a time.

The settings are applied by ``/usr/local/sbin/rpanion-system``, installed by the .deb package and by
``deploy/configure_system.sh``. ``deploy/configure_system.sh`` also installs an ``ssh.service`` drop-in that
generates missing SSH host keys; ``deploy/create_image.sh`` removes the host keys from the image only when
the drop-in is present. If the Web GUI is not reachable, the name and password can be changed
on the SD card before the first boot by editing ``user-data`` on the boot partition (``hostname:`` and ``user:``).

## Tests

Unit tests are split into separate commands for the frontend (ReactJS) and backend.

Unit tests can be run with the command:

```bash
npm run testback
npm run testfront
```

Code coverage statistics are automatically calculated for the backend tests.

Linting (via eslint) is available via:

```bash
npm run lint
```

## Releasing

Use ``npx npm-check-updates -u`` to update nodejs libraries.

Use ``npm version minor`` to create a new release commit.

Then update the changelog.md and amend this to the commit.

Then "git push --tags" to create the release PR.

To produce a disk image from a SD card, insert the card and run ``./deploy/create_image.sh``.

