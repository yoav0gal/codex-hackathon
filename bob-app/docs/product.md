# Product Direction

## Summary

Realtime Codex Agent is a macOS Electron application for controlling Codex through a concise, natural conversation. A developer can speak or type in one live session, move between a compact Companion view and an expanded Chat view, and keep a local record of what happened.

The project takes inspiration from the earlier Gerb experiment, especially its voice-first interaction and secure Electron-to-Realtime shape. Gerb is a reference, not a source dependency or an architecture that this project must preserve.

## Problem

Codex work often spans multiple actions: choosing a codebase, starting or resuming a task, reacting to progress, steering the work, and checking the result. Doing all of that through a conventional chat window makes it difficult to stay engaged while working elsewhere.

The agent should make that loop conversational without hiding what Codex is doing or allowing spoken input to silently approve consequential actions.

## Product principles

### One conversation, two views

Companion and Chat are two presentations of the same active Session. Changing views must not create a second Session, lose transcript state, or interrupt an active Realtime connection.

### Voice and text are equal inputs

A user can speak and type during the same Session. Both appear in one ordered transcript and produce the same agent behavior.

### Codex remains the work engine

The desktop agent handles the conversation and delegates coding work to Codex. It should not recreate Codex planning, tools, persistence, or execution inside the Realtime layer.

### Consequential actions stay visible

The agent may start and steer work. Bob-created Tasks deliberately run with
full local access and no approval prompts for the hackathon prototype. A voice
transcript is still not an answer to an interactive request from a Task created
under a different policy; those requests remain visible in Codex Desktop.

### Extensible means maintainable

The first version does not need a plugin system or runtime capability installation. It needs clear module seams, small interfaces, and localized implementations so contributors can add behavior without editing unrelated conversation, UI, and platform code.

## First usable slice

A developer can:

1. Launch the Electron app into Companion view.
2. Start a Realtime Session by voice or from Chat view.
3. Speak and type in a unified conversation.
4. Ask the agent to start, open, continue, steer, or monitor a Codex task for a selected codebase.
5. Turn on Codex Live for one Task and hear its completed progress messages and important state changes while the Session remains connected.
6. Move between Companion and Chat without interrupting the Session.
7. End the Session and later inspect its locally saved Session Record.

## Current implementation

The scaffold already provides:

- the Electron window and both views;
- Realtime WebRTC connection setup;
- voice input, audio output, and input transcription;
- typed messages sent to the same Realtime connection;
- visible connection and response states;
- saved messages and a list of saved records; and
- a main-process security seam for minting short-lived client secrets.

The scaffold does not yet provide:

- a visible task activity panel beyond Bob's spoken/text narration;
- a Desktop user-input or attention UI inside Bob;
- the agreed one-Session-per-live-conversation persistence model;
- automated tests; or
- automatic inactivity sleep.

## Non-goals for the first slice

- General computer control
- Multi-user or human collaboration features
- A public plugin marketplace or runtime plugin loader
- Cloud transcript synchronization
- Production-grade storage or account management
- Reusing or migrating the Gerb implementation wholesale
- Treating voice as an answer to Codex user-input or attention requests
- Reading raw token deltas or narrating every loaded Codex Task

## Success criteria

The first slice succeeds when a developer can complete one visibly verified Codex workflow from a live voice/text Session and another contributor can add or change a Codex action without modifying the Realtime transport or both view implementations.
