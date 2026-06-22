---
name: chrome-devtools
description: "Control and inspect a live Chrome browser for UI testing, debugging, and performance analysis. Use when testing web applications, taking screenshots, inspecting DOM structure, checking console errors, or automating browser interactions."
---

# Chrome DevTools

Use the chrome-devtools MCP tools to control and inspect a live Chrome browser.

## Prerequisites

The `chrome-devtools-mcp` server must be configured for chrome-devtools tools to be available.

### Auto-configuration

If chrome-devtools tools are not available, configure the MCP server automatically based on the environment:

**VS Code / VS Code Insiders** — Add to `.vscode/mcp.json` in the project (create the file if it doesn't exist, merge into existing config if it does):

```json
{
  "servers": {
    "chrome-devtools": {
      "command": "npx",
      "args": ["-y", "chrome-devtools-mcp@latest"]
    }
  }
}
```

After writing the config, tell the user to reload the window or restart the agent session for the MCP server to be picked up.

**Copilot CLI** — Add to `~/.copilot/mcp-config.json` (create if it doesn't exist, merge into existing `mcpServers` if it does):

```json
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": ["-y", "chrome-devtools-mcp@latest", "--headless"]
    }
  }
}
```

The server is available immediately after writing the config — no restart needed.

### Manual installation (VS Code only)

Alternatively, the user can install it as a plugin:

1. Open VS Code Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`)
2. Run **Chat: Install Plugin From Source**
3. Paste: `https://github.com/ChromeDevTools/chrome-devtools-mcp`

## Core Workflow

### Before interacting with a page

1. **Navigate**: `navigate_page` or `new_page`
2. **Wait**: `wait_for` to ensure content is loaded
3. **Snapshot**: `take_snapshot` to get page structure with element `uid`s
4. **Interact**: Use `uid`s from snapshot for `click`, `fill`, etc.

### Tool selection

- **Automation/interaction**: `take_snapshot` — text-based, faster, better for finding elements and verifying structure
- **Visual inspection**: `take_screenshot` — when you need to see actual visual rendering (layout, colors, spacing, overlaps)
- **Data extraction**: `evaluate_script` — for data not in the accessibility tree (computed styles, JS state, console errors)

### Page management

- `list_pages` to see available pages
- `select_page` to switch context
- Tools operate on the currently selected page

## Efficient usage

- Use `filePath` parameter for large outputs (screenshots, snapshots, traces)
- Use pagination (`pageIdx`, `pageSize`) and filtering (`types`) to minimize data
- Set `includeSnapshot: false` on input actions unless you need updated page state
- You can send multiple tool calls in parallel, but maintain order: navigate → wait → snapshot → interact

## Common checks

- **Layout issues**: `take_screenshot` to visually verify element positioning, spacing, overflow
- **Accessibility**: `take_snapshot` to verify semantic structure, ARIA labels, focus order
- **Console errors**: `evaluate_script` with `console.error` monitoring
- **Responsive design**: resize viewport with `evaluate_script`, then `take_screenshot` at different sizes
- **Interactive elements**: `click` buttons, `fill` forms, verify state changes with `take_snapshot`
- **Performance**: use tracing tools to identify slow interactions
