"""
Typed contracts for cross-module integration.

These are intentional duplicates of shapes owned by RPE and MCA. APM contracts
on shape, not import — if a teammate changes their schema, our copy here flags
the drift in code review and CI tests rather than silently accepting changes.
"""
