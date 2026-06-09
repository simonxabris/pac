# Full replacement over compatibility bridges

PAC is prerelease, so existing prototype APIs and internal plan types should be movable when they block the production-ready architecture. We will replace product-specific planning types such as `PlanAction` with the generic `Plan`, `ResourceChange`, `Operation`, and `Diagnostic` model directly rather than preserving temporary compatibility bridges that would constrain the new design.
