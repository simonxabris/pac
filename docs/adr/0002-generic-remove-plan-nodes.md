# Generic Remove plan nodes

PAC uses a provider-neutral `Remove` plan node for managed current resources that are absent from desired configuration.

Removal mode is declared by each resource adapter:

- `archive` for reversible or provider-retained removals such as Polar Products and Meters.
- `delete` for destructive removals such as Polar Benefits.

This replaces the generic `Archive` plan node, which encoded Polar-specific behavior into the planner. Current resources expose `isRemoved` as their lifecycle flag; provider decoders map their native fields (`isArchived`, `archivedAt`, `isDeleted`, etc.) into that generic state.

`pac plan` renders both modes. During lowering, generated operations carry explicit `destructiveness` metadata (`NonDestructive` or `Destructive` with a reason). All active-resource removals lower to destructive operations: archive-mode Product/Meter removals become `ArchiveProduct` / `ArchiveMeter`, and delete-mode Benefit removals become `DeleteBenefit`. `pac deploy` asks for all destructive-operation consent before applying any operation unless `--allow-destructive` is passed.
