# KAI Host Agent

KAI Host Agent is the supplier-side device identity and control service for KAI Hosting V2. Version `1.0.0` in this checkpoint implements:

- Ed25519 device identity generated on the host;
- five-minute, single-use pairing challenge consumption;
- signed RTX 4090 or H100 inventory registration;
- raw hostname and GPU UUID hashing before transmission;
- signed, monotonically sequenced heartbeats;
- automatic offline reporting when inventory collection fails;
- signed command polling with a lease-based retry path;
- six fixed verification checks for GPU identity, NVIDIA compute mode, memory, storage, network and the declared public port;
- immutable-image `PROVISION` through a separate root actuator that accepts one fixed operation over a local Unix socket;
- a hardened, non-root Host Agent without Docker access or an arbitrary shell.

This checkpoint executes `VERIFY` and creates, but does not start, one isolated `PROVISION` container. `START`, `STOP` and `CLEANUP` remain fail-closed. Do not distribute it as a complete rental agent yet.

## Host requirements

- Ubuntu with systemd
- Node.js 24.15 or newer
- NVIDIA driver with `nvidia-smi`
- Docker Engine with NVIDIA Container Toolkit and the local Docker Unix socket
- exactly one supported GPU for the first production profile
- stable public host and a reserved port range of at most 200 ports

## Install and pair

Run `install.sh` from an inspected release bundle as root. The installer never downloads code and starts only the constrained actuator; the networked Host Agent remains stopped.

Before accepting any rental, put the exact KAI-approved `repository@sha256` image references in `/etc/kai-host-actuator.env` and restart `kai-host-actuator`. Tags are rejected. The approved image contract runs as UID/GID `1000:1000`, listens for SSH on container port `2222`, reads `/home/kai/.ssh/authorized_keys`, and uses `/workspace` for writable data.

Copy the pairing JSON from the supplier console into a root-owned temporary file, then run the pairing command as the restricted service user:

```text
sudo -u kai-host-agent -- kai-host-agent pair \
  --display-name "4090 工作站 01" \
  --public-host "gpu.example.com" \
  --ssh-port-start "22000" \
  --ssh-port-end "22019" < pairing.json
```

After pairing succeeds:

```text
sudo systemctl enable --now kai-host-agent
```

The private device key is stored at `/var/lib/kai-host-agent/identity.json` with mode `0600`. Pairing material and private keys must never be pasted into chat, support tickets, logs, or command arguments.
