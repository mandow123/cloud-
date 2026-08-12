# KAI Host Agent

KAI Host Agent is the supplier-side device identity and control service for KAI Hosting V2. Version `1.5.0` in this checkpoint implements:

- Ed25519 device identity generated on the host;
- five-minute, single-use pairing challenge consumption;
- signed RTX 4090 or H100 inventory registration;
- raw hostname and GPU UUID hashing before transmission;
- signed, monotonically sequenced heartbeats;
- automatic offline reporting when inventory collection fails;
- signed command polling with a lease-based retry path;
- six fixed verification checks for GPU identity, NVIDIA compute mode, memory, storage, network and the declared public port;
- immutable-image `PROVISION` through a separate root actuator that accepts one fixed operation over a local Unix socket;
- contract-bound `START` followed by a public-endpoint SSH protocol readiness check;
- contract-bound `STOP` with fixed graceful shutdown and runtime-duration evidence;
- a persistent local lease watchdog that stops expired workloads even while Cloud is unreachable;
- fail-closed `CLEANUP` that removes the stopped container, temporary SSH key and per-contract workspace before reuse;
- a hardened, non-root Host Agent without Docker access or an arbitrary shell.

This checkpoint executes `VERIFY`, `PROVISION`, `START`, `STOP` and `CLEANUP` through fixed operations. A contract reaches service only after the SSH endpoint presents a valid SSH 2.0 banner, reaches acceptance only after the same container is confirmed stopped, and becomes reusable only after container, key and workspace absence is verified. Production rollout still requires a real approved image and machine-level golden-loop rehearsal.

## Host requirements

- Ubuntu with systemd
- Node.js 24.15 or newer
- NVIDIA driver with `nvidia-smi`
- Docker Engine with NVIDIA Container Toolkit and the local Docker Unix socket
- exactly one supported GPU for the first production profile
- stable public host and a reserved port range of at most 200 ports

## Install and pair

Download the versioned archive and its SHA-256 file from [the KAI Cloud Host Agent guide](https://cloud.kai.com/guides/host-agent). Verify the archive before extraction, inspect `release-manifest.json` and `install.sh`, then run `install.sh` as root. Never pipe a network download into a root shell. The installer never downloads code and starts only the constrained actuator; the networked Host Agent remains stopped.

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
