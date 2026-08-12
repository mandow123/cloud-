FROM nvidia/cuda:12.8.1-runtime-ubuntu24.04@sha256:828c4d878adcaa4265d80c95d8ec877149b49bb2419a4cf3bb6aa889bbb7ca2e

ARG KAI_WORKLOAD_REVISION
LABEL org.opencontainers.image.title="KAI Cloud GPU Workload" \
      org.opencontainers.image.revision="${KAI_WORKLOAD_REVISION}" \
      org.opencontainers.image.source="https://github.com/mandow123/cloud-"

ENV DEBIAN_FRONTEND=noninteractive \
    NVIDIA_VISIBLE_DEVICES=all \
    NVIDIA_DRIVER_CAPABILITIES=compute,utility

RUN printf '%s\n' "$KAI_WORKLOAD_REVISION" | grep -Eq '^([0-9a-f]{40}|[0-9a-f]{64})$' \
    && ! printf '%s\n' "$KAI_WORKLOAD_REVISION" | grep -Eq '^0+$' \
    && apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates openssh-server tini \
    && rm -rf /var/lib/apt/lists/* \
    && test "$(getent passwd 1000 | cut -d: -f1)" = ubuntu \
    && test "$(getent group 1000 | cut -d: -f1)" = ubuntu \
    && groupmod --new-name kai ubuntu \
    && usermod --login kai --home /workspace --shell /bin/bash ubuntu \
    && usermod --groups kai kai \
    && test "$(id -u kai):$(id -g kai):$(id -Gn kai)" = "1000:1000:kai" \
    && install -d -o root -g root -m 0755 /run/sshd \
    && install -d -o kai -g kai -m 0700 /home/kai/.ssh /workspace

COPY --chown=root:root sshd_config /etc/ssh/sshd_config
COPY --chown=root:root entrypoint.sh /usr/local/bin/kai-workload-entrypoint
RUN chmod 0755 /usr/local/bin/kai-workload-entrypoint \
    && ssh-keygen -q -t ed25519 -N '' -f /tmp/kai-build-host-key \
    && sshd -t -f /etc/ssh/sshd_config -h /tmp/kai-build-host-key \
    && rm -f /tmp/kai-build-host-key /tmp/kai-build-host-key.pub

USER 1000:1000
WORKDIR /workspace
EXPOSE 2222
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/kai-workload-entrypoint"]
