#!/usr/bin/env python3
from __future__ import annotations

import os
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path


if len(sys.argv) != 3:
    raise SystemExit("usage: deploy_order_safe.py CANDIDATE APP_DIR")

candidate = Path(sys.argv[1]).resolve()
app_dir = Path(sys.argv[2]).resolve()
server = app_dir / "server.py"
environment = app_dir / ".env"
if not candidate.is_file() or not server.is_file() or not environment.is_file():
    raise SystemExit("deployment inputs are incomplete")

stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
shutil.copy2(server, app_dir / f"server.py.backup-{stamp}")
shutil.copy2(environment, app_dir / f".env.backup-{stamp}")

lines = environment.read_text(encoding="utf-8").splitlines()
key = "KAI_APP_ORDER_ONLY_ENABLED"
replacement = f"{key}=true"
updated: list[str] = []
found = False
for line in lines:
    if line.startswith(f"{key}="):
        if not found:
            updated.append(replacement)
            found = True
        continue
    updated.append(line)
if not found:
    updated.append(replacement)

env_temp = environment.with_name(f".env.order-safe-{stamp}.tmp")
env_temp.write_text("\n".join(updated) + "\n", encoding="utf-8")
os.chmod(env_temp, 0o600)
os.replace(env_temp, environment)

server_temp = app_dir / f"server.py.order-safe-{stamp}.tmp"
shutil.copy2(candidate, server_temp)
os.chmod(server_temp, 0o644)
os.replace(server_temp, server)
print(stamp)
