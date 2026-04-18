"use client";

import { type FC, type ReactNode, useMemo } from "react";
import { useAuiState } from "@assistant-ui/store";
import { useShallow } from "zustand/shallow";
import type { PartState } from "../../../store/scopes/part";
import type {
  MessagePartStatus,
  ToolCallMessagePartStatus,
} from "../../../types/message";
import {
  buildGroupTree,
  type GroupKey,
  type GroupNode,
  normalizeGroupKey,
} from "../../utils/groupParts";
import { PartRangeContext } from "./PartRangeContext";

export namespace MessagePrimitivePartGroups {
  export type GroupInfo = {
    /** Group key of this level; `null` for implicit leaf runs. */
    readonly groupKey: string | null;
    /** Full path from the root down to this node (empty for root-level leaves). */
    readonly keyPath: readonly string[];
    /** 1-indexed nesting depth (0 for root-level leaves). */
    readonly depth: number;
    /** Part indices contained in this node, in order. */
    readonly indices: readonly number[];
    /** Snapshot of the parts contained in this node. */
    readonly parts: readonly PartState[];
    /** True iff the last contained part is still streaming. */
    readonly isStreaming: boolean;
    /** Status of the last contained part. */
    readonly status: MessagePartStatus | ToolCallMessagePartStatus;
    /**
     * For groups: the recursively-rendered inner content (subgroups + their
     * own leaf renders).
     * For leaf runs (groupKey === null): `null`. Use a `default:` branch to
     * render `<MessagePrimitive.Parts>` for the range — that branch also
     * catches unhandled named groups, which then render flat (effectively
     * skipping the group wrapper).
     */
    readonly children: ReactNode;
  };

  export type Props = {
    /**
     * Maps each part to its group key path. Adjacent parts sharing a prefix
     * coalesce up to that prefix. Return `null`, `undefined`, or `[]` to leave
     * a part ungrouped (it lands in `case null:` in your render switch).
     *
     * For best performance, pass a stable reference (module-level constant or
     * `useCallback`) — an inline arrow function rebuilds the group tree on
     * every parent render even when `parts` hasn't changed.
     *
     * @example
     * ```ts
     * const groupBy = (part) =>
     *   part.type === "reasoning" ? ["thought", "reasoning"] :
     *   part.type === "tool-call" ? ["thought", "tool"] :
     *   null;
     * ```
     */
    readonly groupBy: (
      part: PartState,
      index: number,
      parts: readonly PartState[],
    ) => GroupKey;

    /**
     * Render function called once per group node and once per implicit leaf
     * run. Switch on `groupKey` to wrap each named group; use `default:` to
     * render `<MessagePrimitive.Parts>` — it catches both leaf runs
     * (`groupKey === null`) and any group keys you haven't (yet) wrapped, so
     * adding a new key to `groupBy` without a matching case just renders the
     * parts flat.
     */
    readonly children: (info: GroupInfo) => ReactNode;
  };
}

const COMPLETE_STATUS: MessagePartStatus = Object.freeze({ type: "complete" });

const renderNode = (
  node: GroupNode,
  parts: readonly PartState[],
  render: (info: MessagePrimitivePartGroups.GroupInfo) => ReactNode,
): ReactNode => {
  const status = parts[node.indices.at(-1)!]?.status ?? COMPLETE_STATUS;

  const info: MessagePrimitivePartGroups.GroupInfo = {
    keyPath: node.keyPath,
    depth: node.depth,
    indices: node.indices,
    parts: node.indices.map((i) => parts[i]!),
    isStreaming: status.type === "running",
    status,
    ...(node.type === "leaf"
      ? { groupKey: null, children: null }
      : {
          groupKey: node.key,
          children: (
            <>
              {node.children.map((child) => renderNode(child, parts, render))}
            </>
          ),
        }),
  };

  return (
    <PartRangeContext.Provider key={node.nodeKey} value={node.indices}>
      {render(info)}
    </PartRangeContext.Provider>
  );
};

/**
 * Groups adjacent message parts into a tree of coalesced runs.
 *
 * The children render function is called once per group node and once per
 * implicit leaf run (siblings at every depth). Wrap each named group in its
 * own `case`; use `default:` to render `<MessagePrimitive.Parts>` for the
 * range. The `default:` branch catches both leaf runs and any unhandled named
 * groups, so adding a new key to `groupBy` without a matching case just
 * renders those parts flat.
 *
 * @example
 * ```tsx
 * <MessagePrimitive.PartGroups
 *   groupBy={(part) =>
 *     part.type === "reasoning" ? ["thought", "reasoning"] :
 *     part.type === "tool-call" ? ["thought", "tool"] :
 *     null
 *   }
 * >
 *   {({ groupKey, isStreaming, children }) => {
 *     switch (groupKey) {
 *       case "thought": return <ChainOfThought>{children}</ChainOfThought>;
 *       case "reasoning": return <Reasoning.Root defaultOpen={isStreaming}>{children}</Reasoning.Root>;
 *       case "tool": return <ToolStack>{children}</ToolStack>;
 *       default:
 *         return (
 *           <MessagePrimitive.Parts>
 *             {({ part }) => renderLeafPart(part)}
 *           </MessagePrimitive.Parts>
 *         );
 *     }
 *   }}
 * </MessagePrimitive.PartGroups>
 * ```
 */
export const MessagePrimitivePartGroups: FC<
  MessagePrimitivePartGroups.Props
> = ({ groupBy, children }) => {
  const parts = useAuiState(useShallow((s) => s.message.parts));

  const tree = useMemo(
    () =>
      buildGroupTree(
        parts.map((part, i) => normalizeGroupKey(groupBy(part, i, parts))),
      ),
    [parts, groupBy],
  );

  return <>{tree.map((node) => renderNode(node, parts, children))}</>;
};

MessagePrimitivePartGroups.displayName = "MessagePrimitive.PartGroups";
