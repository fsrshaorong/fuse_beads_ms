#!/usr/bin/env bash
set -euo pipefail

# Run as root with the uploaded .server directory. Does not change existing Node or Nginx services.
source_dir="$(realpath "${1:?Usage: deploy-server.sh /path/to/server-bundle}")"
test "$(id -u)" = 0
test -s "$source_dir/main.mjs"
test -s "$source_dir/build-info.json"
app_root=/opt/fuse-beads-ms
node_version=24.13.0
node_dir="$app_root/runtime/node-v$node_version-linux-x64"
test "$(uname -m)" = x86_64
install -d -m 755 "$app_root/runtime" "$app_root/releases" /etc/fuse-beads-ms

if ! test -x "$node_dir/bin/node"; then
    download_dir="$(mktemp -d "$app_root/runtime/download-XXXXXX")"
    archive="node-v$node_version-linux-x64.tar.xz"
    curl --fail --location --retry 3 --connect-timeout 20 "https://nodejs.org/dist/v$node_version/$archive" -o "$download_dir/$archive"
    curl --fail --location --retry 3 --connect-timeout 20 "https://nodejs.org/dist/v$node_version/SHASUMS256.txt" -o "$download_dir/SHASUMS256.txt"
    (cd "$download_dir" && grep " $archive\$" SHASUMS256.txt | sha256sum --check -)
    tar -xJf "$download_dir/$archive" -C "$app_root/runtime"
fi
"$node_dir/bin/node" --version
if ! id fusebeadsms >/dev/null 2>&1; then
    useradd --system --no-create-home --home-dir /var/lib/fuse-beads-ms --shell /sbin/nologin fusebeadsms
fi
install -d -o fusebeadsms -g fusebeadsms -m 750 /var/lib/fuse-beads-ms /var/lib/fuse-beads-ms/backups

release_id="$(date -u +%Y%m%dT%H%M%SZ)-$(sha256sum "$source_dir/main.mjs" | cut -c1-12)"
release_dir="$app_root/releases/$release_id"
install -d -m 755 "$release_dir"
install -m 644 "$source_dir/main.mjs" "$source_dir/build-info.json" "$release_dir/"
install -m 644 "$source_dir/fuse-beads-ms.service" /etc/systemd/system/fuse-beads-ms.service
install -m 755 "$source_dir/backup-server.py" "$app_root/backup-server.py"
install -m 644 "$source_dir/fuse-beads-ms-backup.service" /etc/systemd/system/fuse-beads-ms-backup.service
install -m 644 "$source_dir/fuse-beads-ms-backup.timer" /etc/systemd/system/fuse-beads-ms-backup.timer
if ! test -e /etc/fuse-beads-ms/server.env; then
    cat > /etc/fuse-beads-ms/server.env <<'ENV'
NODE_ENV=production
MULTIPLAYER_HOST=127.0.0.1
MULTIPLAYER_PORT=2567
MULTIPLAYER_DB=/var/lib/fuse-beads-ms/multiplayer.sqlite
MULTIPLAYER_ORIGINS=http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:4173,atelier://game,https://101.132.62.222,http://101.132.62.222
ENV
    chmod 600 /etc/fuse-beads-ms/server.env
fi
previous="$(readlink "$app_root/current" || true)"
if test -f /var/lib/fuse-beads-ms/multiplayer.sqlite; then
    runuser -u fusebeadsms -- /usr/bin/python3 "$app_root/backup-server.py"
fi
ln -sfn "$release_dir" "$app_root/current.next"
mv -Tf "$app_root/current.next" "$app_root/current"
systemctl daemon-reload
systemctl enable fuse-beads-ms.service fuse-beads-ms-backup.timer
systemctl restart fuse-beads-ms.service
systemctl start fuse-beads-ms-backup.timer
for attempt in $(seq 1 20); do
    if curl --fail --silent http://127.0.0.1:2567/health; then
        printf '\nBackend active: %s\n' "$release_dir"
        exit 0
    fi
    sleep 1
done
if test -n "$previous"; then
    ln -sfn "$previous" "$app_root/current.next"
    mv -Tf "$app_root/current.next" "$app_root/current"
    systemctl restart fuse-beads-ms.service
fi
journalctl -u fuse-beads-ms.service -n 25 --no-pager
exit 1
