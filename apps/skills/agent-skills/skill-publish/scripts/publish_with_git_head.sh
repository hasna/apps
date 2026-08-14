#!/usr/bin/env bash
set -euo pipefail

for required_command in git node npm tar; do
  if ! command -v "$required_command" >/dev/null 2>&1; then
    printf 'publish_with_git_head: %s is required\n' "$required_command" >&2
    exit 127
  fi
done

package_dir=$(pwd -P)
if [ ! -f "$package_dir/package.json" ]; then
  printf 'publish_with_git_head: no package.json in %s\n' "$package_dir" >&2
  exit 2
fi

repo_root=$(git -C "$package_dir" rev-parse --show-toplevel)
head_sha=$(git -C "$repo_root" rev-parse HEAD)
source_tree=$(git -C "$repo_root" rev-parse "$head_sha^{tree}")
package_prefix=$(git -C "$package_dir" rev-parse --show-prefix)
package_relative=${package_prefix%/}
source_status=$(git -C "$repo_root" status --porcelain --untracked-files=no)

if [ -n "$source_status" ]; then
  printf 'publish_with_git_head: tracked source changes must be committed before publish\n' >&2
  exit 2
fi

temp_root=$(mktemp -d "${TMPDIR:-/tmp}/hasna-publish-githead.XXXXXX")
clone_root="$temp_root/repo"
pack_dir="$temp_root/pack"
unpack_dir="$temp_root/unpack"
pack_json="$temp_root/pack.json"

cleanup() {
  local temp_name
  temp_name=$(basename "$temp_root")
  case "$temp_name" in
    hasna-publish-githead.*)
      rm -rf -- "$temp_root"
      ;;
    *)
      printf 'publish_with_git_head: refusing to remove unexpected temp path %s\n' \
        "$temp_root" >&2
      return 1
      ;;
  esac
}

handle_exit() {
  local command_rc=$?
  trap - EXIT INT TERM
  if ! cleanup; then
    exit 70
  fi
  exit "$command_rc"
}

trap handle_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

mkdir -p "$pack_dir" "$unpack_dir"
(
  cd "$package_dir"
  npm pack --ignore-scripts --json --pack-destination "$pack_dir"
) > "$pack_json"

tarball_name=$(
  node -e '
    const fs = require("node:fs");
    const result = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    if (!Array.isArray(result) || result.length !== 1 || !result[0]?.filename) {
      process.exit(2);
    }
    process.stdout.write(result[0].filename);
  ' "$pack_json"
)
tarball="$pack_dir/$tarball_name"
if [ ! -f "$tarball" ]; then
  printf 'publish_with_git_head: npm pack did not create %s\n' "$tarball" >&2
  exit 2
fi

git clone --quiet --no-hardlinks --no-checkout "$repo_root" "$clone_root"
git -C "$clone_root" checkout --quiet --detach "$head_sha"

clone_head=$(git -C "$clone_root" rev-parse HEAD)
clone_tree=$(git -C "$clone_root" rev-parse "HEAD^{tree}")
clone_status=$(git -C "$clone_root" status --porcelain)
if [ "$clone_head" != "$head_sha" ] || [ "$clone_tree" != "$source_tree" ]; then
  printf 'publish_with_git_head: disposable clone does not match source HEAD/tree\n' >&2
  exit 2
fi
if [ -n "$clone_status" ]; then
  printf 'publish_with_git_head: disposable clone is not clean before staging package files\n' >&2
  exit 2
fi

if [ -n "$package_relative" ]; then
  clone_package_dir="$clone_root/$package_relative"
else
  clone_package_dir="$clone_root"
fi
if [ ! -d "$clone_package_dir" ]; then
  printf 'publish_with_git_head: package subdirectory missing in clone: %s\n' \
    "$package_relative" >&2
  exit 2
fi

tar -xzf "$tarball" -C "$unpack_dir"
cp -a "$unpack_dir/package/." "$clone_package_dir/"

if [ -d "$repo_root/node_modules" ] && [ ! -e "$clone_root/node_modules" ]; then
  ln -s "$repo_root/node_modules" "$clone_root/node_modules"
fi
if [ "$package_dir" != "$repo_root" ] &&
  [ -d "$package_dir/node_modules" ] &&
  [ ! -e "$clone_package_dir/node_modules" ]; then
  ln -s "$package_dir/node_modules" "$clone_package_dir/node_modules"
fi

node -e '
  const fs = require("node:fs");
  const source = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const staged = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  if (source.name !== staged.name || source.version !== staged.version) {
    process.exit(2);
  }
' "$package_dir/package.json" "$clone_package_dir/package.json"

if [ "$(git -C "$repo_root" rev-parse HEAD)" != "$head_sha" ] ||
  [ "$(git -C "$repo_root" rev-parse "HEAD^{tree}")" != "$source_tree" ]; then
  printf 'publish_with_git_head: source HEAD/tree changed while preparing publish\n' >&2
  exit 2
fi

printf 'publish_with_git_head: publishing %s from disposable clone at HEAD %s\n' \
  "${package_relative:-.}" "$head_sha" >&2
(
  cd "$clone_package_dir"
  npm publish "$@"
)
