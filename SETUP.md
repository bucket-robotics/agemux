# Set up agemux

These instructions are for the coding agent installing agemux. Install the
latest release, enable shell integration, and verify both. Do not build from
source or edit the user's shell configuration by hand.

The machine must use zsh or bash and run macOS 13 or newer or glibc 2.17 or
newer Linux on arm64 or x64. x64 machines need SSE4.2. It must already have:

- `curl`
- `unzip`
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

agemux_version=$("$HOME/.local/bin/agemux" --version)
agemux_application_dir="${XDG_DATA_HOME:-$HOME/.local/share}/agemux/$agemux_version"
test -s "$agemux_application_dir/LICENSE"
test -s "$agemux_application_dir/THIRD_PARTY_NOTICES"

verify_agemux_shell_config() {
  grep -F '# >>> agemux >>>' "$1" >/dev/null
  grep -F "$HOME/.local/bin/agemux" "$1" >/dev/null
}

case "${SHELL##*/}" in
  zsh)
    agemux_shell_config="$HOME/.zshrc"
    verify_agemux_shell_config "$agemux_shell_config"
    ;;
  bash)
    if [ -e "$HOME/.bash_profile" ]; then
      agemux_bash_login="$HOME/.bash_profile"
    elif [ -e "$HOME/.bash_login" ]; then
      agemux_bash_login="$HOME/.bash_login"
    else
      agemux_bash_login="$HOME/.profile"
    fi
    verify_agemux_shell_config "$HOME/.bashrc"
    verify_agemux_shell_config "$agemux_bash_login"
    agemux_shell_config="$HOME/.bashrc and $agemux_bash_login"
    ;;
  *) echo "unsupported shell: ${SHELL:-unknown}" >&2; exit 1 ;;
esac

printf 'agemux %s installed at %s\n' \
  "$("$HOME/.local/bin/agemux" --version)" \
  "$HOME/.local/bin/agemux"
printf 'shell integration installed in %s\n' "$agemux_shell_config"
```

When the commands pass, tell the user to open a new shell and run `claude` or
`codex` with no arguments.
