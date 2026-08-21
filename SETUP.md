# Set up agemux

These instructions are for the coding agent installing agemux. Install the
latest release, enable shell integration, and verify both. Do not build from
source or edit the user's shell configuration by hand.

The machine must run macOS or Linux on arm64 or x64. It must already have:

- `curl`
- the Claude or Codex CLI

Run this as the user who will use agemux:

```sh
set -eu

command -v curl >/dev/null
command -v claude >/dev/null || command -v codex >/dev/null

agemux_setup_dir=$(mktemp -d)
trap 'rm -rf "$agemux_setup_dir"' EXIT HUP INT TERM

curl --fail --location --silent --show-error --proto '=https' --tlsv1.2 \
  https://github.com/bucket-robotics/agemux/releases/latest/download/agemux-install \
  --output "$agemux_setup_dir/agemux-install"

sh "$agemux_setup_dir/agemux-install"
"$HOME/.local/bin/agemux" --version
"$HOME/.local/bin/agemux" --help >/dev/null
"$HOME/.local/bin/agemux" setup

case "${SHELL##*/}" in
  zsh) agemux_shell_config="$HOME/.zshrc" ;;
  bash) agemux_shell_config="$HOME/.bashrc" ;;
  *) echo "unsupported shell: ${SHELL:-unknown}" >&2; exit 1 ;;
esac

grep -F '# >>> agemux >>>' "$agemux_shell_config" >/dev/null
grep -F "$HOME/.local/bin/agemux" "$agemux_shell_config" >/dev/null

printf 'agemux %s installed at %s\n' \
  "$("$HOME/.local/bin/agemux" --version)" \
  "$HOME/.local/bin/agemux"
printf 'shell integration installed in %s\n' "$agemux_shell_config"
```

When the commands pass, tell the user to open a new shell and run `claude` or
`codex` with no arguments.
