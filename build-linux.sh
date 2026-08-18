#!/usr/bin/env bash
# Arch Linux build script for Marko - converts the Tauri .deb bundle to a .pkg.tar.zst via debtap
set -euo pipefail

# ── Arch package configuration ───────────────────────────────────────────────
# Deps to strip from .PKGINFO (debtap binary analysis may add mismatched names)
STRIP_DEPS=("gtk")
# ─────────────────────────────────────────────────────────────────────────────

pnpm tauri build

# ── Convert .deb → Arch .pkg.tar.zst ─────────────────────────────────────────
DEB_DIR="src-tauri/target/release/bundle/deb"
DEB_FILE=$(ls "$DEB_DIR"/marko_*_amd64.deb | sort -V | tail -1)

echo "==> Converting $DEB_FILE to Arch package"
(cd "$DEB_DIR" && debtap -Q "$(basename "$DEB_FILE")")

PKG_FILE=$(ls "$DEB_DIR"/marko-*.pkg.tar.zst | sort -V | tail -1)
echo "==> Patching $PKG_FILE"

WORK=$(mktemp -d)
cleanup() {
    rm -rf "$WORK"
}
trap cleanup EXIT

tar -C "$WORK" -xf "$PKG_FILE"

for dep in "${STRIP_DEPS[@]}"; do
    sed -i "/^depend = ${dep}\([^0-9a-zA-Z]\|$\)/d" "$WORK/.PKGINFO"
done

# Fix .INSTALL: use absolute paths so gtk-update-icon-cache/update-desktop-database
# work regardless of pacman's cwd during the transaction.
if [ -f "$WORK/.INSTALL" ]; then
    sed -i 's|gtk-update-icon-cache \(.*\)usr/share/icons/hicolor|gtk-update-icon-cache \1/usr/share/icons/hicolor|g' "$WORK/.INSTALL"
    sed -i 's|update-desktop-database -q$|update-desktop-database -q /usr/share/applications|g' "$WORK/.INSTALL"
fi

echo "==> Final depends:"
grep '^depend' "$WORK/.PKGINFO"

# .MTREE checksums cover .PKGINFO — drop it to avoid pacman rejecting the patch.
rm -f "$WORK/.MTREE"

# Repack: pacman strcmp(entry_name, ".PKGINFO") requires no leading "./" prefix.
ABS_PKG=$(realpath "$PKG_FILE")
(cd "$WORK" && find . -mindepth 1 -printf '%P\0' | sort -z \
    | tar --no-recursion --null -cf - -T - \
    | zstd -19 --threads=0 -fo "$ABS_PKG")

echo "==> Arch package: $PKG_FILE"
echo "==> Install with: sudo pacman -U $PKG_FILE"

# ── Notification ──────────────────────────────────────────────────────────────
notify-send "BUILD COMPLETE" "Marko build is complete" 2>/dev/null
paplay /usr/share/sounds/freedesktop/stereo/complete.oga 2>/dev/null || printf '\a'
