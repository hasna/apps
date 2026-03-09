import * as React from "react";
import { ChevronRightIcon, HashIcon, MessageSquareIcon, UsersIcon } from "lucide-react";
import type { Space } from "@/types";

interface SpacesTreeProps {
  spaces: Space[];
  onSelectSpace: (name: string) => void;
}

interface TreeNode {
  space: Space;
  children: TreeNode[];
}

function buildTree(spaces: Space[]): TreeNode[] {
  const map = new Map<string, TreeNode>();
  for (const s of spaces) {
    map.set(s.name, { space: s, children: [] });
  }

  const roots: TreeNode[] = [];
  for (const s of spaces) {
    const node = map.get(s.name)!;
    if (s.parent_id && map.has(s.parent_id)) {
      map.get(s.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

function SpaceNode({ node, depth, onSelect }: { node: TreeNode; depth: number; onSelect: (name: string) => void }) {
  const [expanded, setExpanded] = React.useState(true);
  const hasChildren = node.children.length > 0;
  const s = node.space;

  return (
    <div>
      <div
        className="flex items-center gap-2 rounded-lg px-3 py-2.5 hover:bg-muted/50 cursor-pointer group transition-colors"
        style={{ paddingLeft: `${12 + depth * 24}px` }}
        onClick={() => onSelect(s.name)}
      >
        {hasChildren ? (
          <button
            className="size-5 flex items-center justify-center rounded hover:bg-muted shrink-0"
            onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
          >
            <ChevronRightIcon className={`size-3.5 transition-transform ${expanded ? "rotate-90" : ""}`} />
          </button>
        ) : (
          <span className="size-5 shrink-0" />
        )}

        <HashIcon className="size-4 text-muted-foreground shrink-0" />

        <span className="font-medium text-sm flex-1 truncate">{s.name}</span>

        <div className="flex items-center gap-3 text-xs text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
          <span className="flex items-center gap-1">
            <MessageSquareIcon className="size-3" />
            {s.message_count}
          </span>
          <span className="flex items-center gap-1">
            <UsersIcon className="size-3" />
            {s.member_count}
          </span>
        </div>
      </div>

      {s.description && (
        <p className="text-xs text-muted-foreground truncate" style={{ paddingLeft: `${12 + depth * 24 + 28}px` }}>
          {s.description}
        </p>
      )}

      {hasChildren && expanded && (
        <div>
          {node.children.map((child) => (
            <SpaceNode key={child.space.name} node={child} depth={depth + 1} onSelect={onSelect} />
          ))}
        </div>
      )}
    </div>
  );
}

export function SpacesTree({ spaces, onSelectSpace }: SpacesTreeProps) {
  const tree = React.useMemo(() => buildTree(spaces), [spaces]);

  if (spaces.length === 0) {
    return (
      <div className="rounded-xl border p-8 text-center text-muted-foreground">
        No spaces yet. Create one with{" "}
        <code className="text-xs bg-muted px-1.5 py-0.5 rounded">conversations space create</code>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-lg font-semibold mb-4">Spaces</h2>
      <div className="rounded-xl border divide-y">
        {tree.map((node) => (
          <SpaceNode key={node.space.name} node={node} depth={0} onSelect={onSelectSpace} />
        ))}
      </div>
    </div>
  );
}
