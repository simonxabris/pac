# Generic Remove plan nodes

PAC uses a provider-neutral `Remove` plan node for managed current resources that are absent from desired configuration.

Removal mode is declared by each resource adapter:

- `archive` for reversible or provider-retained removals such as Polar Products and Meters.
- `delete` for destructive removals such as Polar Benefits.

This replaces the generic `Archive` plan node, which encoded Polar-specific behavior into the planner. Current resources expose `isRemoved` as their lifecycle flag; provider decoders map their native fields (`isArchived`, `archivedAt`, `isDeleted`, etc.) into that generic state.

`pac plan` renders both modes, while `pac deploy` refuses delete-mode removals unless `--allow-delete` is passed.
