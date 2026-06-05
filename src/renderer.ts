import { Console, Effect, Layer } from "effect";
import * as Context from "effect/Context";
import type { Diagnostic, Plan, PlanNode } from "./planner.js";

const renderNode = (node: PlanNode): string => {
  switch (node._tag) {
    case "Create":
      return `  + ${node.address} (${node.kind})`;
    case "Update":
      return `  ~ ${node.address} (${node.kind})`;
    case "Archive":
      return `  - ${node.address} (${node.kind})`;
    case "Noop":
      return `  = ${node.address} (${node.kind})`;
    case "Blocked":
      return `  ! ${node.address} (${node.kind})`;
  }
};

const renderDiagnostic = (diagnostic: Diagnostic): string => {
  const address = diagnostic.address ? ` [${diagnostic.address}]` : "";
  return `  [${diagnostic.severity.toUpperCase()}] ${diagnostic.code}${address}: ${diagnostic.message}`;
};

export class Renderer extends Context.Service<
  Renderer,
  {
    readonly render: (plan: Plan) => Effect.Effect<void>;
  }
>()("@app/Renderer") {
  static readonly layer = Layer.succeed(
    Renderer,
    Renderer.of({
      render: (plan) =>
        Effect.gen(function*() {
          const nodes = [...plan.nodes.values()];
          const creates = nodes.filter((n) => n._tag === "Create");
          const updates = nodes.filter((n) => n._tag === "Update");
          const archives = nodes.filter((n) => n._tag === "Archive");
          const noops = nodes.filter((n) => n._tag === "Noop");
          const blocked = nodes.filter((n) => n._tag === "Blocked");

          yield* Console.log("");
          yield* Console.log(`Plan Summary (${nodes.length} resources)`);
          yield* Console.log("─".repeat(40));

          if (creates.length > 0) {
            yield* Console.log(`\nCreate (${creates.length}):`);
            for (const node of creates) {
              yield* Console.log(renderNode(node));
            }
          }

          if (updates.length > 0) {
            yield* Console.log(`\nUpdate (${updates.length}):`);
            for (const node of updates) {
              yield* Console.log(renderNode(node));
            }
          }

          if (archives.length > 0) {
            yield* Console.log(`\nArchive (${archives.length}):`);
            for (const node of archives) {
              yield* Console.log(renderNode(node));
            }
          }

          if (noops.length > 0) {
            yield* Console.log(`\nNo change (${noops.length}):`);
            for (const node of noops) {
              yield* Console.log(renderNode(node));
            }
          }

          if (blocked.length > 0) {
            yield* Console.log(`\nBlocked (${blocked.length}):`);
            for (const node of blocked) {
              yield* Console.log(renderNode(node));
            }
          }

          if (plan.edges.length > 0) {
            yield* Console.log(`\nDependencies (${plan.edges.length}):`);
            for (const edge of plan.edges) {
              yield* Console.log(`  ${edge.from} -> ${edge.to}`);
            }
          }

          if (plan.diagnostics.length > 0) {
            yield* Console.log(`\nDiagnostics (${plan.diagnostics.length}):`);
            for (const diagnostic of plan.diagnostics) {
              yield* Console.log(renderDiagnostic(diagnostic));
            }
          }

          yield* Console.log("");
        }),
    }),
  );
}
