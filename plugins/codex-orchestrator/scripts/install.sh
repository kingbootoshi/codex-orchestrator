#!/bin/bash
# Codex Orchestrator - Installation Script
# Installs the codex-agent CLI and its dependencies.
# Uses only official package managers. No third-party scripts.

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

INSTALL_DIR="${CODEX_ORCHESTRATOR_HOME:-$HOME/.codex-orchestrator}"
REPO_URL="https://github.com/kingbootoshi/codex-orchestrator.git"

# Resolve the directory where this script lives
SCRIPT_SOURCE="${BASH_SOURCE[0]}"
while [ -L "$SCRIPT_SOURCE" ]; do
  SCRIPT_DIR="$(cd -P "$(dirname "$SCRIPT_SOURCE")" && pwd)"
  SCRIPT_SOURCE="$(readlink "$SCRIPT_SOURCE")"
  [[ $SCRIPT_SOURCE != /* ]] && SCRIPT_SOURCE="$SCRIPT_DIR/$SCRIPT_SOURCE"
done
SCRIPT_DIR="$(cd -P "$(dirname "$SCRIPT_SOURCE")" && pwd)"

info() { echo -e "${BLUE}[info]${NC} $1"; }
success() { echo -e "${GREEN}[ok]${NC} $1"; }
warn() { echo -e "${YELLOW}[warn]${NC} $1"; }
error() { echo -e "${RED}[error]${NC} $1"; }

# -------------------------------------------------------------------
# Platform detection
# -------------------------------------------------------------------
detect_platform() {
  case "$(uname -s)" in
    Linux*)   PLATFORM="linux" ;;
    Darwin*)  PLATFORM="macos" ;;
    CYGWIN*|MINGW*|MSYS*)
      PLATFORM="windows"
      ;;
    *)
      error "Unsupported platform: $(uname -s)"
      exit 1
      ;;
  esac

  info "Platform: $PLATFORM ($(uname -m))"
}

# -------------------------------------------------------------------
# Convert a Git Bash / MSYS path to a WSL /mnt/ path
# -------------------------------------------------------------------
convert_to_wsl_path() {
  local win_path="$1"
  if [[ "$win_path" =~ ^/([a-zA-Z])/ ]]; then
    echo "/mnt/${BASH_REMATCH[1],,}/${win_path:3}"
  elif [[ "$win_path" =~ ^([a-zA-Z]):\\ ]]; then
    local drive="${win_path:0:1}"
    drive="${drive,,}"
    local rest="${win_path:3}"
    rest="${rest//\\//}"
    echo "/mnt/${drive}/${rest}"
  elif [[ "$win_path" =~ ^([a-zA-Z]):/ ]]; then
    local drive="${win_path:0:1}"
    drive="${drive,,}"
    echo "/mnt/${drive}/${win_path:3}"
  else
    echo "$win_path"
  fi
}

# -------------------------------------------------------------------
# Windows: install via WSL and create bridge shim
# -------------------------------------------------------------------
install_via_wsl() {
  info "Windows detected — installing via WSL"
  echo ""

  # Check wsl.exe is available
  if ! command -v wsl.exe &>/dev/null && ! command -v wsl &>/dev/null; then
    error "WSL is not installed."
    echo ""
    echo "Install WSL from an admin PowerShell:"
    echo "  wsl --install"
    echo ""
    echo "Then restart your computer and re-run this script."
    exit 1
  fi

  # Check WSL has a default distro configured
  local wsl_cmd="wsl.exe"
  command -v wsl.exe &>/dev/null || wsl_cmd="wsl"

  if ! $wsl_cmd --status &>/dev/null; then
    error "WSL is installed but no default distribution is configured."
    echo ""
    echo "Set up a Linux distribution:"
    echo "  wsl --install -d Ubuntu"
    echo ""
    echo "Then re-run this script."
    exit 1
  fi

  success "WSL is available"

  # Convert this script's path to WSL format and run inside WSL
  local wsl_script_path
  wsl_script_path="$(convert_to_wsl_path "$SCRIPT_DIR/install.sh")"

  info "Running install inside WSL..."
  echo ""

  if ! $wsl_cmd -e bash -c "bash '${wsl_script_path}'"; then
    error "WSL installation failed."
    exit 1
  fi

  success "WSL-side installation complete"
  echo ""

  # Create Windows-side bridge shim
  create_windows_shim

  # Verify the shim works
  echo ""
  info "Verifying Windows bridge..."
  echo ""

  local shim_path="$HOME/bin/codex-agent"
  if [ -f "$shim_path" ] && bash "$shim_path" health; then
    echo ""
    success "Windows WSL bridge is working!"
    echo ""
    echo "Quick start:"
    echo "  codex-agent start \"Review this codebase for issues\" --map"
    echo "  codex-agent jobs --json"
    echo "  codex-agent capture <jobId>"
    echo ""
    echo "All commands work directly from Git Bash or PowerShell."
    echo "Windows paths are automatically converted to WSL paths."
  else
    error "Bridge verification failed."
    echo ""
    echo "Try running manually:"
    echo "  bash $shim_path health"
    exit 1
  fi

  if ! command -v codex-agent &>/dev/null; then
    warn "codex-agent is not on your PATH."
    echo ""
    echo "Add this to your shell profile:"
    echo "  export PATH=\"\$HOME/bin:\$PATH\""
  fi
}

# -------------------------------------------------------------------
# Create the Windows-side codex-agent shim and WSL bridge
# -------------------------------------------------------------------
create_windows_shim() {
  local bin_dir="$HOME/bin"
  local shim_path="$bin_dir/codex-agent"
  local bridge_path="$bin_dir/codex-agent-wsl.sh"

  mkdir -p "$bin_dir"

  info "Creating WSL bridge at $bridge_path"

  # Copy the bridge wrapper from the scripts directory
  local source_bridge="$SCRIPT_DIR/codex-agent-wsl.sh"
  if [ -f "$source_bridge" ]; then
    cp "$source_bridge" "$bridge_path"
  else
    # Generate inline if source not found (e.g. curl install)
    cat > "$bridge_path" << 'BRIDGE_EOF'
#!/bin/bash
# codex-agent WSL bridge - Routes commands through WSL with path conversion

convert_win_to_wsl() {
    local win_path="$1"
    if [[ "$win_path" =~ ^/([a-zA-Z])/ ]]; then
        echo "/mnt/${BASH_REMATCH[1],,}/${win_path:3}"
    elif [[ "$win_path" =~ ^([a-zA-Z]):\\ ]]; then
        local drive="${win_path:0:1}"
        drive="${drive,,}"
        local rest="${win_path:3}"
        rest="${rest//\\//}"
        echo "/mnt/${drive}/${rest}"
    elif [[ "$win_path" =~ ^([a-zA-Z]):/ ]]; then
        local drive="${win_path:0:1}"
        drive="${drive,,}"
        echo "/mnt/${drive}/${win_path:3}"
    else
        echo "$win_path"
    fi
}

ARGS=()
SKIP_NEXT=false

for i in "$@"; do
    if $SKIP_NEXT; then
        SKIP_NEXT=false
        ARGS+=("$(convert_win_to_wsl "$i")")
        continue
    fi
    case "$i" in
        -d|--dir|-f|--file)
            ARGS+=("$i")
            SKIP_NEXT=true
            ;;
        *)
            ARGS+=("$i")
            ;;
    esac
done

WSL_CWD="$(convert_win_to_wsl "$(pwd)")"

wsl -e bash -lc "cd '${WSL_CWD}' 2>/dev/null; export PATH=\"\$HOME/.bun/bin:\$HOME/.codex-orchestrator/bin:\$PATH\"; codex-agent ${ARGS[*]}"
BRIDGE_EOF
  fi

  chmod +x "$bridge_path"

  info "Creating shim at $shim_path"

  cat > "$shim_path" << SHIM_EOF
#!/bin/bash
# codex-agent — Windows WSL bridge shim
exec bash "$bridge_path" "\$@"
SHIM_EOF

  chmod +x "$shim_path"

  success "Windows shim created at $shim_path"
}

# -------------------------------------------------------------------
# Detect package manager (Linux only)
# -------------------------------------------------------------------
detect_linux_pkg_manager() {
  if command -v apt-get &>/dev/null; then
    PKG_MANAGER="apt"
  elif command -v dnf &>/dev/null; then
    PKG_MANAGER="dnf"
  elif command -v yum &>/dev/null; then
    PKG_MANAGER="yum"
  elif command -v pacman &>/dev/null; then
    PKG_MANAGER="pacman"
  elif command -v apk &>/dev/null; then
    PKG_MANAGER="apk"
  elif command -v zypper &>/dev/null; then
    PKG_MANAGER="zypper"
  else
    PKG_MANAGER=""
  fi
}

# -------------------------------------------------------------------
# Check and install tmux
# -------------------------------------------------------------------
check_tmux() {
  if command -v tmux &>/dev/null; then
    success "tmux: $(tmux -V)"
    return 0
  fi

  warn "tmux not found. Installing..."

  if [ "$PLATFORM" = "macos" ]; then
    if ! command -v brew &>/dev/null; then
      error "Homebrew not found. Install it from https://brew.sh then re-run this script."
      exit 1
    fi
    brew install tmux
  elif [ "$PLATFORM" = "linux" ]; then
    detect_linux_pkg_manager
    case "$PKG_MANAGER" in
      apt)     sudo apt-get update && sudo apt-get install -y tmux ;;
      dnf)     sudo dnf install -y tmux ;;
      yum)     sudo yum install -y tmux ;;
      pacman)  sudo pacman -S --noconfirm tmux ;;
      apk)     sudo apk add tmux ;;
      zypper)  sudo zypper install -y tmux ;;
      *)
        error "No supported package manager found. Install tmux manually:"
        echo "  https://github.com/tmux/tmux/wiki/Installing"
        exit 1
        ;;
    esac
  fi

  if command -v tmux &>/dev/null; then
    success "tmux installed: $(tmux -V)"
  else
    error "tmux installation failed."
    exit 1
  fi
}

# -------------------------------------------------------------------
# Check and install Bun
# -------------------------------------------------------------------
check_bun() {
  if command -v bun &>/dev/null; then
    success "bun: $(bun --version)"
    return 0
  fi

  warn "Bun not found. Installing via official installer..."
  echo ""
  info "Bun install page: https://bun.sh"
  echo ""

  # Official Bun installer from bun.sh
  curl -fsSL https://bun.sh/install | bash

  # Source the updated profile so bun is on PATH
  export BUN_INSTALL="$HOME/.bun"
  export PATH="$BUN_INSTALL/bin:$PATH"

  if command -v bun &>/dev/null; then
    success "bun installed: $(bun --version)"
  else
    error "Bun installation failed. Install manually from https://bun.sh"
    exit 1
  fi
}

# -------------------------------------------------------------------
# Check for OpenAI Codex CLI
# -------------------------------------------------------------------
check_codex() {
  if command -v codex &>/dev/null; then
    success "codex CLI: found"
    return 0
  fi

  warn "OpenAI Codex CLI not found."
  echo ""
  echo "The Codex CLI is the coding agent that codex-orchestrator controls."
  echo ""
  echo "Install it with npm:"
  echo "  npm install -g @openai/codex"
  echo ""
  echo "Then authenticate with your OpenAI account:"
  echo "  codex --login"
  echo ""
  echo "More info: https://github.com/openai/codex"
  echo ""

  read -p "Do you want to install it now with npm? [y/N] " -n 1 -r
  echo
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    if command -v npm &>/dev/null; then
      npm install -g @openai/codex
      if command -v codex &>/dev/null; then
        success "codex CLI installed"
        echo ""
        warn "You still need to authenticate: codex --login"
      else
        error "Codex CLI installation failed."
        exit 1
      fi
    else
      error "npm not found. Install Node.js first: https://nodejs.org"
      exit 1
    fi
  else
    warn "Skipping Codex CLI install. You'll need it before using codex-agent."
  fi
}

# -------------------------------------------------------------------
# Install codex-orchestrator
# -------------------------------------------------------------------
install_orchestrator() {
  if [ -d "$INSTALL_DIR" ]; then
    info "Updating existing installation at $INSTALL_DIR"
    cd "$INSTALL_DIR"
    git pull --ff-only origin main
  else
    info "Cloning codex-orchestrator to $INSTALL_DIR"
    git clone "$REPO_URL" "$INSTALL_DIR"
    cd "$INSTALL_DIR"
  fi

  info "Installing dependencies..."
  bun install

  # Add to PATH
  local BIN_DIR="$INSTALL_DIR/bin"
  local PATH_LINE="export PATH=\"$BIN_DIR:\$PATH\""

  if command -v codex-agent &>/dev/null; then
    success "codex-agent already on PATH"
  else
    # Detect shell profile
    local SHELL_PROFILE=""
    if [ -n "$ZSH_VERSION" ] || [ "$SHELL" = "$(which zsh 2>/dev/null)" ]; then
      SHELL_PROFILE="$HOME/.zshrc"
    elif [ -f "$HOME/.bashrc" ]; then
      SHELL_PROFILE="$HOME/.bashrc"
    elif [ -f "$HOME/.bash_profile" ]; then
      SHELL_PROFILE="$HOME/.bash_profile"
    fi

    if [ -n "$SHELL_PROFILE" ]; then
      # Check if already in profile
      if grep -q "codex-orchestrator/bin" "$SHELL_PROFILE" 2>/dev/null; then
        info "PATH entry already in $SHELL_PROFILE"
      else
        echo "" >> "$SHELL_PROFILE"
        echo "# codex-orchestrator" >> "$SHELL_PROFILE"
        echo "$PATH_LINE" >> "$SHELL_PROFILE"
        success "Added to PATH in $SHELL_PROFILE"
      fi
    else
      warn "Could not detect shell profile."
      echo ""
      echo "Add this line to your shell profile manually:"
      echo "  $PATH_LINE"
    fi

    # Make it available in current session
    export PATH="$BIN_DIR:$PATH"
  fi
}

# -------------------------------------------------------------------
# Verify installation
# -------------------------------------------------------------------
verify() {
  echo ""
  info "Running health check..."
  echo ""

  if command -v codex-agent &>/dev/null; then
    codex-agent health
  elif [ -f "$INSTALL_DIR/bin/codex-agent" ]; then
    "$INSTALL_DIR/bin/codex-agent" health
  else
    error "codex-agent binary not found after installation."
    exit 1
  fi

  echo ""
  success "Installation complete!"
  echo ""
  echo "Quick start:"
  echo "  codex-agent start \"Review this codebase for issues\" --map"
  echo "  codex-agent jobs --json"
  echo "  codex-agent capture <jobId>"
  echo ""

  if ! command -v codex &>/dev/null; then
    warn "Reminder: Install the Codex CLI before using codex-agent:"
    echo "  npm install -g @openai/codex"
    echo "  codex --login"
  fi
}

# -------------------------------------------------------------------
# Main
# -------------------------------------------------------------------
main() {
  echo ""
  echo "========================================="
  echo "  Codex Orchestrator - Setup"
  echo "========================================="
  echo ""

  detect_platform
  echo ""

  # Windows: delegate to WSL and create bridge shim
  if [ "$PLATFORM" = "windows" ]; then
    install_via_wsl
    return
  fi

  check_tmux
  check_bun
  check_codex

  echo ""
  install_orchestrator

  verify
}

main "$@"
