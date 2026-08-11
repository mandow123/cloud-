# KAI Host Agent

KAI Host Agent is the supplier-side device identity and control service for KAI Hosting V2. Version `1.0.0` in this checkpoint implements:

- Ed25519 device identity generated on the host;
- five-minute, single-use pairing challenge consumption;
- signed RTX 4090 or H100 inventory registration;
- raw hostname and GPU UUID hashing before transmission;
- signed, monotonically sequenced heartbeats;
- automatic offline reporting when inventory collection fails;
- a hardened, non-root systemd service without Docker access or an arbitrary shell.

This checkpoint does **not** execute verification or workload commands yet. Do not distribute or enable it on production hosts until the command worker and its verification tests land in the next checkpoint.

## Host requirements

- Ubuntu with systemd
- Node.js 24.15 or newer
- NVIDIA driver with `nvidia-smi`
- exactly one supported GPU for the first production profile
- stable public host and a reserved port range of at most 200 ports

## Install and pair

Run `install.sh` from an inspected release bundle as root. The installer never downloads code and does not start the service.

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
