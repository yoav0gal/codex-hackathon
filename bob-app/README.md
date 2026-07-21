# Realtime Codex Agent

An Electron desktop agent for working with Codex through a natural voice or text conversation. It has two views over the same live conversation:

- **Companion view** — a compact, always-available voice presence.
- **Chat view** — an expanded transcript, text composer, and session history.

The first product slice will let a developer start, open, continue, steer, and monitor Codex tasks. The codebase is intended to stay easy for other developers to understand and extend as the agent gains capabilities.

## Project status

The repository currently contains a working Realtime foundation:

- OpenAI Realtime voice and text over WebRTC
- companion and chat views in one Electron window
- a unified transcript for spoken and typed messages
- local JSON persistence for saved conversation records
- short-lived Realtime client secrets minted in the Electron main process
- local “Hey, Bob” wake-word detection while sleeping
- a shared Codex app-server capability owned by Electron main
- Realtime tools for finding and opening local Codex projects, plus starting,
  continuing, monitoring, interrupting, searching, opening, and checking Tasks
- a Google Chrome tool for opening, navigating, and managing browser tabs
- live completion and attention notifications from Codex back into Bob
- Codex Live, which marks one Task and reads its completed progress messages
  and important state changes aloud while the Realtime Session is connected

Starting, continuing, and monitoring a Codex Task leaves Codex Desktop in the
background. Bob opens or foregrounds Codex only when the user explicitly asks.
Ask Bob to “turn on Codex Live for &lt;task&gt;” to select one Task, switch it by
naming another Task, or ask him to turn Codex Live off. Streaming token deltas
are coalesced at completed message boundaries so each update is spoken once.

When Bob first controls Google Chrome, macOS may ask for permission to let Bob
automate it. The tool supports opening Chrome, opening or navigating tabs,
listing/activating/closing tabs, and back, forward, and reload actions.

Codex task control is implemented against the managed local app-server daemon.
Bob and Codex Desktop receive true live updates only when Desktop is launched
against that same daemon; the helper below performs that experimental launch.

There is also one known model mismatch: the current code calls a persisted conversation record a `ChatSession` and may reconnect it to multiple Realtime connections. The agreed product language defines a **Session** as one live Realtime conversation. See [Session lifecycle](docs/session-lifecycle.md) for the intended model and migration gap.

## Documentation

- [Product direction](docs/product.md)
- [Architecture](docs/architecture.md)
- [Session lifecycle](docs/session-lifecycle.md)
- [Domain language](CONTEXT.md)

## Repository map

- `src/agent/` owns the Realtime connection and conversation events without importing Electron.
- `src/application/main/` owns Electron lifecycle, the standard OpenAI API key, window modes, and local persistence.
- `src/application/preload/` exposes a narrow typed IPC bridge to the renderer.
- `src/application/renderer/` owns the current companion and chat interface.
- `src/contracts/` defines values allowed to cross Electron IPC.

The implemented Codex seam and intended evolution are described in [Architecture](docs/architecture.md).

## Current interaction model

The app starts as a sleeping companion at the right side of the active screen. It stays above other windows and reflects the agent state: sleeping, connecting, listening, thinking, speaking, or error.

Say **“Hey, Bob”** to start a fresh voice session without expanding the window. Dormant wake audio is processed locally with sherpa-onnx and is not sent to OpenAI. Clicking the companion also starts a fresh voice session and expands the chat. Say **“go to sleep”** or press the active voice button to disconnect Realtime, release its microphone, collapse the app, and rearm local wake detection.

Companion mode can still collapse an active conversation without ending it. The chat accepts typed messages and voice in one transcript. Final messages are saved locally in Electron's per-user application data directory.

## Run

```sh
npm install
npm run setup:wake
cp .env.example .env.local
# Add OPENAI_API_KEY to .env.local
npm start
```

## Share Codex Tasks with Bob

The installed Desktop app normally owns a private stdio app-server. Prepare the
managed daemon, quit Codex Desktop normally, and relaunch it once on the shared
Unix socket:

```sh
npm run codex:prepare
# Quit Codex Desktop normally.
npm run codex:launch
npm start
```

`codex:launch` uses the installed app's private
`CODEX_APP_SERVER_USE_LOCAL_DAEMON=1` switch for that launch only. Bob never
answers user-input requests from monitored tasks: he reports that attention is
needed, and Codex Desktop remains the interaction surface. Run
`npm run codex:status` to verify both the daemon and the running Desktop process;
the command fails when Desktop is still using its private stdio servers.

Optional `.env.local` settings are documented in `.env.example`. By default,
Bob uses `gpt-5.6-terra` with `low` reasoning by default, creates general Codex Tasks in the dedicated
`~/Documents/Bob Delegations` project, and uses `~/code` for explicit
project-name resolution. Set `BOB_DELEGATIONS_ROOT` to customize that project
folder. Bob-created and resumed Tasks run in YOLO mode by default: approval
policy `never`, sandbox `danger-full-access`. This is intentional for the local
hackathon prototype and grants delegated work full access as the current user.

For development with Vite reloads:

```sh
npm run dev
```

## Validate

```sh
npm run typecheck
npm test
npm run build
npm run codex:status
```
