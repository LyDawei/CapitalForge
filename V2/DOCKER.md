# V2 — Postgres in Docker: runbook & troubleshooting

The V2 console keeps **only Postgres** in a container (`capitalforge-v2-db`). The
backend (:4000) and frontend (:4001) run locally via `npm run dev`. Data lives in
the managed volume `cf_v2_pgdata` (runtime name is project-prefixed:
`v2_cf_v2_pgdata`), not in a local Postgres install.

---

## Everyday commands

Run these **from `V2/`** — see the first gotcha below.

```bash
# start / stop the DB
docker compose up -d postgres      # start (container owns host :5432)
docker compose down                # stop; data persists in the volume
docker compose down -v             # stop AND WIPE the volume — destroys all cycles

# health + data sanity
docker exec capitalforge-v2-db pg_isready -U postgres
docker exec capitalforge-v2-db psql -U postgres -d capitalforge_v2 -tA -c 'select count(*) from "Cycle";'

# which volume is attached (confirms your data is really mounted)
docker inspect capitalforge-v2-db --format '{{range .Mounts}}{{.Name}} -> {{.Destination}}{{"\n"}}{{end}}'
```

`DATABASE_URL` in `V2/.env` is
`postgresql://postgres:postgres@localhost:5432/capitalforge_v2` and must match the
compose creds. The container `restart: unless-stopped`, so it comes back with the
Docker daemon.

---

## Gotchas

### 1. Run compose from `V2/`, not the repo root
The **repo-root** `docker-compose.yml` is the *legacy `packages/` monorepo* stack
(engine + api + ui, with heavy image builds). The **`V2/docker-compose.yml`** is
DB-only. If you run `docker compose up -d` from the repo root you'll kick off a
full monorepo build — which, in a small Docker VM, can OOM and take the daemon
down (observed: `rpc error … EOF` mid-build). Always:

```bash
cd V2 && docker compose up -d postgres
# or explicitly:
docker compose -f V2/docker-compose.yml up -d postgres
```

### 2. Local Postgres must be off
Host port 5432 is owned by the container. A local `postgresql-x64-16` Windows
service bound to 5432 will collide. It should be set to **Manual** startup and
left stopped. Its data is a **stale snapshot** frozen at the original
`pg_dump`/`pg_restore` migration — never point the app at it, or you'll silently
split-brain the DB.

### 3. VM memory
The Docker VM is set to **4 GB** (`MemoryMiB: 4096` in
`%APPDATA%\Docker\settings-store.json`). 2 GB was too tight and contributed to the
OOM in gotcha #1.

---

## Troubleshooting: Docker won't boot — "The file cannot be accessed by the system"

**Symptom.** Docker Desktop fails to start with a popup like:

```
starting services: initializing Inference manager: listening on
unix://C:/Users/.../Docker/run/dockerInference: remove …dockerInference:
The file cannot be accessed by the system.
```

The service name varies (`Inference manager`, `Secrets Engine`, …) but the shape
is always *"remove `<some>.sock`: The file cannot be accessed by the system"*
(Windows error **1920**).

**Root cause (two compounding faults).**
1. **Orphaned AF_UNIX sockets.** Docker's Windows backend creates unix-domain
   sockets under `%LOCALAPPDATA%\Docker\run\` and `%LOCALAPPDATA%\docker-secrets-engine\`.
   An **unclean** Docker exit leaves these `.sock` files behind as broken reparse
   points that **no tool can delete** — `del`, `fsutil reparsepoint delete`,
   `\\?\` extended paths, .NET `File.Delete`, `robocopy /MIR`, and even a **full
   Windows reboot** all return error 1920. On the next boot Docker does
   `remove(sock)` → `bind(sock)` per service; the `remove` fails → the **backend
   crashes** → that crash orphans *another* socket → the next boot fails on it.
   Self-perpetuating.
2. **Stuck WSL data disk.** `docker_data.vhdx` gets left `WSL_E_USER_VHD_ALREADY_ATTACHED`
   (`0x80040312`), so every boot inherits a half-initialized WSL VM. Killing the
   Windows *processes* does **not** clear this — only `wsl --shutdown` does.

**Diagnosis — read the backend log:**
```
%LOCALAPPDATA%\Docker\log\host\com.docker.backend.exe.log
```
Grep it for `backend crashed`, `cannot be accessed`, and `WSL_E_USER_VHD_ALREADY_ATTACHED`.

### The fix that works

The broken sockets can't be *deleted*, but Docker doesn't need them deleted — it
needs a **clean (absent) socket directory** so it recreates the sockets fresh with
nothing to remove. Renaming the *directory* only touches its parent's entry, not
the un-deletable file inside, so it succeeds.

```powershell
# 1. Fully quit Docker (processes only — this alone is NOT enough)
Get-Process 'Docker Desktop','com.docker.backend','com.docker.build','docker-ai' `
  -EA SilentlyContinue | Stop-Process -Force

# 2. THE STEP EVERYONE MISSES — tear down the WSL VM (detaches the stuck VHD)
wsl --shutdown

# 3. Orphan the canonical socket dirs so Docker recreates them fresh.
#    (Only rename ones that still exist; Docker remakes them on boot.)
$run     = "$env:LOCALAPPDATA\Docker\run"
$secrets = "$env:LOCALAPPDATA\docker-secrets-engine"
if (Test-Path $run)     { Rename-Item $run     "run.broken-$(Get-Random)" }
if (Test-Path $secrets) { Rename-Item $secrets "docker-secrets-engine.broken-$(Get-Random)" }

# 4. Start Docker — and let it boot ALL THE WAY. Do NOT force-kill it mid-boot;
#    an interrupted boot re-orphans sockets and puts you back in the loop.
Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe"
```

Then wait for the daemon and bring the DB up:
```bash
until docker info >/dev/null 2>&1; do sleep 5; done
cd V2 && docker compose up -d postgres
```

### Prevention
- **Quit Docker cleanly** (Docker Desktop tray → *Quit*), never force-kill, so it
  unlinks its own sockets. One clean shutdown cycle stops the orphaning.
- Don't run the repo-root monorepo compose (gotcha #1) — the OOM crash is what
  triggered the unclean exits in the first place.
- The renamed `run.broken-*` / `docker-secrets-engine.broken-*` dirs are harmless
  cruft; they contain the un-deletable sockets and can only be removed by
  `chkdsk /f` (an NTFS repair pass on reboot). Leaving them is fine.

> The `cf_v2_pgdata` volume lives inside `docker_data.vhdx` and is untouched by any
> of the above — none of the socket/VHD dance risks your cycle data. The only
> destructive command is `docker compose down -v`.
