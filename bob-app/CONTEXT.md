# Realtime Codex Agent

Realtime Codex Agent is a desktop companion for controlling Codex through a live voice or text conversation while keeping the resulting work visible and reviewable.

## Language

**Realtime Agent**:
The conversational desktop agent that receives voice or text and can invoke development capabilities.
_Avoid_: Bot, general computer agent

**Session**:
One live conversation between a developer and the Realtime Agent, from activation until the conversation ends.
_Avoid_: Chat thread, saved chat, Codex task

**Session Record**:
The locally persisted account of an ended Session, including its transcript and relevant outcomes.
_Avoid_: Session, chat history

**Companion View**:
The compact presentation of the Realtime Agent intended to remain available beside other work.
_Avoid_: Mini app, widget

**Chat View**:
The expanded presentation of the same Realtime Agent and active Session, including voice and typed messages in one transcript.
_Avoid_: Separate chat session, debug window

**Capability**:
A coherent behavior the Realtime Agent can invoke beyond conversation, such as controlling a Codex Task.
_Avoid_: Plugin, tool, integration

**Codex Task**:
A persistent unit of development work owned and executed by Codex. Multiple Sessions may refer to the same Codex Task.
_Avoid_: Session, Realtime conversation

**Codex Live**:
A runtime setting that marks one Codex Task for automatic spoken delivery of its completed progress messages and important state changes whenever the Realtime Session is connected. Selecting another Codex Task switches the setting; turning it off clears the selection.
_Avoid_: All-task monitoring, token streaming, approval authority
