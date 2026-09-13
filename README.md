# Anta Harness

> Modern desktop GUI harness for AI coding agents.

Anta Harness provides a responsive, native-feeling desktop interface for autonomous coding agents (such as [Pi](https://pi.dev) and [oh-my-pi](https://github.com/can1357/oh-my-pi)).

---

## Features

- **Agent Engine Support**: Seamlessly communicates with Pi and OMP CLI subprocesses via high-performance JSONL RPC mode.
- **Multi-Workspace Management**: Manage multiple project workspaces and live session runtimes concurrently.
- **Interactive Chat & Streaming**: Real-time streaming responses, markdown syntax highlighting, tool call cards, and clickable file paths.
- **Integrated Terminal & Diff Review**: Built-in xterm.js terminal, Git file status tracking, side-by-side diff review, and Issue-to-PR conveyor.
- **Secure Sandboxed Architecture**: Context-isolated renderer, typed IPC contracts, per-workspace trust gating, and sandboxed web previews.
- **Customizable Themes & Settings**: Built-in and user-defined themes with tokenized semantic colors, configurable thinking levels, and provider API management.

---

## Prerequisites

- **Node.js**: `v18.0.0` or higher
- **Package Manager**: `npm` (v9+)
- **Coding Agent CLI**: [Pi](https://pi.dev) or [oh-my-pi (omp)](https://github.com/can1357/oh-my-pi) installed on your system:
  ```bash
  # Install Pi CLI
  curl -fsSL https://pi.dev/install.sh | sh
  # or via npm
  npm install -g @earendil-works/pi-coding-agent
  ```

---

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

> **Note**: A postinstall script automatically rebuilds native modules (such as `node-pty`) for Electron and validates the Electron binary.

### 2. Development

```bash
# Build and preview with hot reloading
npm run dev

# Or run Vite dev server directly
npm run dev:hot
```

### 3. Testing & Code Quality

```bash
# Run unit tests
npm test

# Run tests in watch mode
npm run test:watch

# TypeScript type checking
npm run typecheck

# Code style linting & semantic color token verification
npm run lint
```

---

## Building & Packaging

```bash
# Compile TypeScript & bundle renderer/main/preload via electron-vite
npm run build

# Package desktop application for current platform
npm run package

# Platform-specific packaging
npm run build:mac      # macOS DMG and ZIP
npm run build:win      # Windows NSIS Installer & Portable
npm run build:linux    # Linux AppImage
npm run build:all      # Build for all platforms

# Clean build artifacts
npm run clean
```

Packaging artifacts are output to the `release/` directory.

---

## CLI Launcher

You can launch Anta Harness directly from the command line:

```bash
# Launch with default workspace
npx anta-harness

# Open a specific project directory
npx anta-harness /path/to/my-project

# Show version or help
npx anta-harness --version
npx anta-harness --help
```

---

## License

[Apache-2.0](LICENSE) © Anta Harness Contributors
