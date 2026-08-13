import type { ReactElement } from "react";
import type { Editor as TiptapEditor } from "@tiptap/react";

/** Props for the {@link Toolbar} component. */
export interface ToolbarProps {
  editor: TiptapEditor | null;
}

interface ButtonSpec {
  label: string;
  title: string;
  isActive?: () => boolean;
  run: () => void;
  disabled?: () => boolean;
}

/**
 * A formatting toolbar for the {@link Editor}. Renders unstyled buttons with
 * `data-active` attributes so consumers can theme it with CSS.
 */
export function Toolbar({ editor }: ToolbarProps): ReactElement | null {
  if (!editor) return null;

  const promptLink = () => {
    const previous = editor.getAttributes("link").href as string | undefined;
    const url =
      typeof window !== "undefined" ? window.prompt("Link URL", previous ?? "https://") : null;
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  };

  const groups: ButtonSpec[][] = [
    [
      {
        label: "B",
        title: "Bold",
        isActive: () => editor.isActive("bold"),
        run: () => editor.chain().focus().toggleBold().run(),
      },
      {
        label: "I",
        title: "Italic",
        isActive: () => editor.isActive("italic"),
        run: () => editor.chain().focus().toggleItalic().run(),
      },
      {
        label: "S",
        title: "Strike-through",
        isActive: () => editor.isActive("strike"),
        run: () => editor.chain().focus().toggleStrike().run(),
      },
      {
        label: "</>",
        title: "Inline code",
        isActive: () => editor.isActive("code"),
        run: () => editor.chain().focus().toggleCode().run(),
      },
    ],
    [
      {
        label: "H1",
        title: "Heading 1",
        isActive: () => editor.isActive("heading", { level: 1 }),
        run: () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
      },
      {
        label: "H2",
        title: "Heading 2",
        isActive: () => editor.isActive("heading", { level: 2 }),
        run: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
      },
      {
        label: "H3",
        title: "Heading 3",
        isActive: () => editor.isActive("heading", { level: 3 }),
        run: () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
      },
    ],
    [
      {
        label: "• List",
        title: "Bullet list",
        isActive: () => editor.isActive("bulletList"),
        run: () => editor.chain().focus().toggleBulletList().run(),
      },
      {
        label: "1. List",
        title: "Ordered list",
        isActive: () => editor.isActive("orderedList"),
        run: () => editor.chain().focus().toggleOrderedList().run(),
      },
      {
        label: "❝",
        title: "Blockquote",
        isActive: () => editor.isActive("blockquote"),
        run: () => editor.chain().focus().toggleBlockquote().run(),
      },
      {
        label: "Code",
        title: "Code block",
        isActive: () => editor.isActive("codeBlock"),
        run: () => editor.chain().focus().toggleCodeBlock().run(),
      },
    ],
    [
      {
        label: "Link",
        title: "Add/edit link",
        isActive: () => editor.isActive("link"),
        run: promptLink,
      },
      {
        label: "―",
        title: "Horizontal rule",
        run: () => editor.chain().focus().setHorizontalRule().run(),
      },
    ],
    [
      {
        label: "↶",
        title: "Undo",
        run: () => editor.chain().focus().undo().run(),
        disabled: () => !editor.can().undo(),
      },
      {
        label: "↷",
        title: "Redo",
        run: () => editor.chain().focus().redo().run(),
        disabled: () => !editor.can().redo(),
      },
    ],
  ];

  return (
    <div className="hasna-docs-toolbar" role="toolbar" aria-label="Formatting">
      {groups.map((group, gi) => (
        <div className="hasna-docs-toolbar__group" key={gi}>
          {group.map((btn) => (
            <button
              key={btn.title}
              type="button"
              title={btn.title}
              aria-label={btn.title}
              aria-pressed={btn.isActive ? btn.isActive() : undefined}
              data-active={btn.isActive ? btn.isActive() : undefined}
              disabled={btn.disabled ? btn.disabled() : false}
              onClick={btn.run}
              className="hasna-docs-toolbar__button"
            >
              {btn.label}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
