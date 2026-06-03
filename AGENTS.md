# Overview

This project aims to provide an infrastacture as code type of experience to the polar payment platform.
What i want is i create my products in code and then run `paac deploy` or similar and it will create those products in polar.

# Polar api reference

The polar openapi spec is in `./docs/reference/polar-openapi.json` .

# Local Effect Source

The Effect repository beta/v4 is cloned to `~/.local/share/effect-solutions/effect-v4` for reference.
Use this to explore APIs, find usage examples, and understand implementation details when the documentation isn't enough.

`~/.local/share/effect-solutions/executor` is an app implemented with idiomatic effect v4 source code. Use it for inspiration.

`~/.local/share/effect-solutions/opencode` is the source code of the opencode coding agent and is full of of useful idiomatic effect examples.

# IaaC patterns

The top level `sst` folder is the source code of the sst infrastructure as code library. Use it to research IaaC related patterns and questions.
