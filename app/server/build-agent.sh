#!/usr/bin/env bash
# Packages app/server into a single downloadable executable (Node's Single Executable
# Application feature), so a non-technical person can run the local agent — the piece
# that owns their terminal, Codex execution, and project storage — without installing
# Node.js or cloning the repo themselves.
#
# Output: dist-agent/manga-agent (the executable) + dist-agent/node_modules/ (sharp and
# node-pty's native binaries, which can't be embedded inside the executable itself — see
# the shims below). Ship both together; the executable looks for node_modules right next
# to itself at runtime.
#
# Only builds for the CURRENT platform/architecture — native modules (sharp, node-pty)
# ship prebuilt per-OS binaries, so a Windows/Mac executable has to be built by running
# this same script on an actual Windows/Mac machine, not cross-compiled from here.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

OUT_DIR="dist-agent"
BUILD_SRC="$OUT_DIR/build-src"
EXE_NAME="manga-agent"
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) EXE_NAME="manga-agent.exe" ;;
esac

echo "== Cleaning previous build =="
rm -rf "$OUT_DIR"
mkdir -p "$BUILD_SRC/shims"

echo "== Patching __dirname for the packaged executable's own location =="
# Source files compute __dirname via import.meta.url (needed for normal `node index.js`
# dev usage) — for the packaged executable, storage/etc. should live next to the
# executable itself instead, so this is patched only in these throwaway copies.
cp index.js codex.js store.js terminal.js prompt.js scene.js "$BUILD_SRC/"
for f in store.js terminal.js codex.js index.js; do
  sed -i.bak 's|const __dirname = path.dirname(fileURLToPath(import.meta.url));|const __dirname = path.dirname(process.execPath);|' "$BUILD_SRC/$f"
  rm -f "$BUILD_SRC/$f.bak"
done

echo "== Writing native-module shims (sharp, node-pty) =="
# SEA's embedded require() only loads Node's own built-ins, not arbitrary packages from
# disk — these reach into a real node_modules folder shipped next to the executable via
# createRequire (a runtime call esbuild won't try to statically resolve/bundle away,
# unlike a literal require("sharp")).
cat > "$BUILD_SRC/shims/sharp-shim.cjs" <<'EOF'
const { createRequire } = require("module");
const path = require("path");
const localRequire = createRequire(path.join(path.dirname(process.execPath), "shim-anchor.cjs"));
module.exports = localRequire("sharp");
EOF
cat > "$BUILD_SRC/shims/node-pty-shim.cjs" <<'EOF'
const { createRequire } = require("module");
const path = require("path");
const localRequire = createRequire(path.join(path.dirname(process.execPath), "shim-anchor.cjs"));
module.exports = localRequire("node-pty");
EOF

echo "== Bundling with esbuild =="
# Alias paths are resolved relative to the CWD, not the entry file — run from inside
# build-src so the ./shims/ paths line up.
(cd "$BUILD_SRC" && npx esbuild index.js \
  --bundle --platform=node --target=node20 --format=cjs \
  --alias:sharp="./shims/sharp-shim.cjs" \
  --alias:node-pty="./shims/node-pty-shim.cjs" \
  --outfile="../bundle.cjs")

echo "== Generating the SEA blob =="
cat > "$OUT_DIR/sea-config.json" <<EOF
{
  "main": "bundle.cjs",
  "output": "sea-prep.blob",
  "disableExperimentalSEAWarning": true
}
EOF
(cd "$OUT_DIR" && node --experimental-sea-config sea-config.json)

echo "== Building the executable =="
cp "$(command -v node)" "$OUT_DIR/$EXE_NAME"
npx postject "$OUT_DIR/$EXE_NAME" NODE_SEA_BLOB "$OUT_DIR/sea-prep.blob" \
  --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
chmod +x "$OUT_DIR/$EXE_NAME"

echo "== Copying native module binaries alongside the executable =="
mkdir -p "$OUT_DIR/node_modules"
cp -r node_modules/node-pty "$OUT_DIR/node_modules/"
cp -r node_modules/sharp "$OUT_DIR/node_modules/"
cp -r node_modules/@img "$OUT_DIR/node_modules/" 2>/dev/null || true
cp -r node_modules/detect-libc "$OUT_DIR/node_modules/" 2>/dev/null || true
cp -r node_modules/semver "$OUT_DIR/node_modules/" 2>/dev/null || true

rm -rf "$BUILD_SRC"

echo ""
echo "Built: $OUT_DIR/$EXE_NAME"
echo "Ship it together with: $OUT_DIR/node_modules/"
echo "Run with: cd $OUT_DIR && PORT=8787 ./$EXE_NAME"
