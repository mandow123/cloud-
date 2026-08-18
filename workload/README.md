# KAI Cloud GPU Workload

This image is the only workload contract supported by the first KAI Host Agent rollout. It is intentionally separate from the Cloud web application.

- Ubuntu 24.04 with the NVIDIA CUDA 12.8 runtime;
- one GPU per container;
- SSH public-key authentication on container port 2222;
- UID/GID 1000, no Root login and no password login;
- `/workspace` is the only persistent writable workspace supplied by the Host Agent;
- the Host Agent adds a read-only per-contract `authorized_keys` file;
- the Host Agent supplies a read-only root filesystem, dropped capabilities, memory/PID limits and an ephemeral `/tmp`;
- the container refuses to start without exactly one NVIDIA GPU.

Only the manually dispatched GitHub workflow publishes this image. Operations must copy the resulting `repository@sha256:...` reference into both the platform and actuator allowlists after inspecting the workflow evidence. Tags are never accepted by the platform.
