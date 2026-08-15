# KAI Host Agent

KAI Host Agent is the supplier-side device identity and control service for KAI Hosting V2. Version `1.9.7` in this checkpoint implements:

- contract-bound cleanup for partially provisioned or SSH-unreachable workloads, so failed delivery can be refunded and proven clean before relisting;

- Ed25519 device identity generated on the host;
- five-minute, single-use pairing challenge consumption;
- signed RTX 4090 or H100 inventory registration;
- raw hostname and GPU UUID hashing before transmission;
- signed, monotonically sequenced heartbeats;
- automatic offline reporting when inventory collection fails;
- root-owned Docker and NVIDIA Runtime preflight exposed to the non-root Agent through one fixed local `DOCTOR` operation, without granting Docker socket access;
- signed command polling with a lease-based retry path;
- seven fixed verification checks for GPU identity, NVIDIA compute mode, memory, storage, network, every approved immutable workload image and the declared public port;
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
- one explicitly selected physical GPU per Agent; multi-GPU hosts remain supported without exposing the other cards
- stable public host and a reserved port range of at most 200 ports

Before installation, run the packaged read-only preflight as root. It does not install services, edit configuration or start containers. Local port availability is not proof of public reachability; only the later one-time Cloud control-plane challenge can provide that evidence:

```text
sudo node ./src/preflight.mjs \
  --public-host "gpu.example.com" \
  --ssh-port-start "22000" \
  --ssh-port-end "22019" \
  --gpu-uuid "GPU-copy-from-nvidia-smi" \
  --storage-path "/var/lib"
```

## Install and pair

Download the versioned archive and its SHA-256 file from [the KAI Cloud Host Agent guide](https://cloud.kai.com/guides/host-agent). Verify the archive before extraction, inspect `release-manifest.json` and `install.sh`, then run `install.sh` as root. Never pipe a network download into a root shell. The installer never downloads code and starts only the constrained actuator; the networked Host Agent remains stopped.

Before accepting any rental, put the exact KAI-approved `repository@sha256` image references in `/etc/kai-host-actuator.env` and restart `kai-host-actuator`. Tags are rejected. The approved image contract runs as UID/GID `1000:1000`, listens for SSH on container port `2222`, reads `/home/kai/.ssh/authorized_keys`, and uses `/workspace` for writable data.

Copy the pairing JSON from the supplier console into a private file owned by the restricted service user. The Agent rejects relative paths, symbolic links, another owner, or group/other-readable modes:

```text
sudo -u kai-host-agent -- kai-host-agent pair \
  --pairing-file /var/lib/kai-host-agent/pairing.json \
  --display-name "4090 工作站 01" \
  --public-host "gpu.example.com" \
  --ssh-port-start "22000" \
  --ssh-port-end "22019" \
  --gpu-uuid "GPU-the-same-physical-card"
```

After pairing succeeds, remove the one-time file and prove the signed heartbeat path before enabling the background service:

```text
sudo shred -u /var/lib/kai-host-agent/pairing.json
sudo -u kai-host-agent -- kai-host-agent check-connection
```

Only a `connection.verified` event proves that Cloud accepted the signed connection check. The check reports the device as OFFLINE and never polls or leases a command, so an unconfigured actuator cannot appear ready for verification. Then enable the service:

```text
sudo systemctl enable --now kai-host-agent
```

The private device key is stored at `/var/lib/kai-host-agent/identity.json` with mode `0600`. Pairing material and private keys must never be pasted into chat, support tickets, logs, or command arguments.
