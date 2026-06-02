"use client";

import { useEffect, type CSSProperties, type ReactNode } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import type { AnyExtension } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "tiptap-markdown";

// tiptap-markdown@0.9.0 attaches a `markdown` storage with getMarkdown() but
// ships no TS augmentation for @tiptap/core's Storage in the v3 type graph, so
// we narrow it locally instead of casting the whole editor to `any`.
type MarkdownStorage = { getMarkdown: () => string };
function getMarkdown(editor: Editor): string {
  const storage = editor.storage as { markdown?: MarkdownStorage };
  return storage.markdown?.getMarkdown() ?? "";
}

// The toolbar commands (toggleBold, toggleHeading, ...) are contributed via
// `declare module '@tiptap/core'` augmentations inside the StarterKit/extension
// packages. When @tiptap/core is duplicated in node_modules those augmentations
// can fail to merge into the core resolved by @tiptap/react, dropping the
// command types from ChainedCommands. We declare the exact subset we call so
// the component type-checks independently of the install's dedup state.
type RunnableChain = { run: () => boolean };
type ToggleChain = {
  focus: () => ToggleChain;
  toggleBold: () => RunnableChain;
  toggleItalic: () => RunnableChain;
  toggleHeading: (attrs: { level: 1 | 2 | 3 }) => RunnableChain;
  toggleBulletList: () => RunnableChain;
  toggleOrderedList: () => RunnableChain;
  toggleCodeBlock: () => RunnableChain;
  toggleBlockquote: () => RunnableChain;
  extendMarkRange: (name: string) => ToggleChain;
  setLink: (attrs: { href: string }) => RunnableChain;
  unsetLink: () => RunnableChain;
};
function chain(editor: Editor): ToggleChain {
  return editor.chain() as unknown as ToggleChain;
}

type TwinEditorProps = {
  value: string;
  onChange?: (markdown: string) => void;
  editable?: boolean;
  placeholder?: string;
};

const toolbarStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: 2,
  padding: "var(--sp-6, 6px) var(--sp-8, 8px)",
  borderBottom: "1px solid var(--hairline)",
  background: "var(--bg-elevated)",
  position: "sticky",
  top: 0,
  zIndex: 1,
};

const dividerStyle: CSSProperties = {
  width: 1,
  alignSelf: "stretch",
  margin: "2px 4px",
  background: "var(--hairline)",
};

function btnStyle(active: boolean, disabled: boolean): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 28,
    height: 28,
    padding: "0 6px",
    border: "1px solid transparent",
    borderRadius: 5,
    background: active ? "var(--accent-soft, rgba(0,0,0,0.06))" : "transparent",
    color: active ? "var(--accent-deep, var(--accent))" : "var(--text)",
    fontSize: "var(--fs-ui, 13px)",
    fontFamily: "inherit",
    fontWeight: active ? 600 : 500,
    lineHeight: 1,
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.4 : 1,
    transition: "background 120ms ease, color 120ms ease",
  };
}

function ToolbarButton(props: {
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  title: string;
  children: ReactNode;
}) {
  const { onClick, active = false, disabled = false, title, children } = props;
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      style={btnStyle(active, disabled)}
    >
      {children}
    </button>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const setLink = () => {
    const prev = (editor.getAttributes("link") as { href?: string }).href ?? "";
    const url = window.prompt("Link URL", prev);
    if (url === null) return;
    if (url === "") {
      chain(editor).focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    chain(editor).focus().extendMarkRange("link").setLink({ href: url }).run();
  };

  return (
    <div style={toolbarStyle} role="toolbar" aria-label="Formatting">
      <ToolbarButton
        title="Bold"
        active={editor.isActive("bold")}
        onClick={() => chain(editor).focus().toggleBold().run()}
      >
        <strong>B</strong>
      </ToolbarButton>
      <ToolbarButton
        title="Italic"
        active={editor.isActive("italic")}
        onClick={() => chain(editor).focus().toggleItalic().run()}
      >
        <em>I</em>
      </ToolbarButton>

      <span style={dividerStyle} aria-hidden />

      <ToolbarButton
        title="Heading 1"
        active={editor.isActive("heading", { level: 1 })}
        onClick={() => chain(editor).focus().toggleHeading({ level: 1 }).run()}
      >
        H1
      </ToolbarButton>
      <ToolbarButton
        title="Heading 2"
        active={editor.isActive("heading", { level: 2 })}
        onClick={() => chain(editor).focus().toggleHeading({ level: 2 }).run()}
      >
        H2
      </ToolbarButton>
      <ToolbarButton
        title="Heading 3"
        active={editor.isActive("heading", { level: 3 })}
        onClick={() => chain(editor).focus().toggleHeading({ level: 3 }).run()}
      >
        H3
      </ToolbarButton>

      <span style={dividerStyle} aria-hidden />

      <ToolbarButton
        title="Bullet list"
        active={editor.isActive("bulletList")}
        onClick={() => chain(editor).focus().toggleBulletList().run()}
      >
        &bull; List
      </ToolbarButton>
      <ToolbarButton
        title="Ordered list"
        active={editor.isActive("orderedList")}
        onClick={() => chain(editor).focus().toggleOrderedList().run()}
      >
        1. List
      </ToolbarButton>

      <span style={dividerStyle} aria-hidden />

      <ToolbarButton
        title="Code block"
        active={editor.isActive("codeBlock")}
        onClick={() => chain(editor).focus().toggleCodeBlock().run()}
      >
        {"</>"}
      </ToolbarButton>
      <ToolbarButton
        title="Blockquote"
        active={editor.isActive("blockquote")}
        onClick={() => chain(editor).focus().toggleBlockquote().run()}
      >
        &ldquo; &rdquo;
      </ToolbarButton>

      <span style={dividerStyle} aria-hidden />

      <ToolbarButton
        title="Link"
        active={editor.isActive("link")}
        onClick={setLink}
      >
        Link
      </ToolbarButton>
    </div>
  );
}

export function TwinEditor(props: TwinEditorProps) {
  const { value, onChange, editable = true, placeholder } = props;

  const editor = useEditor({
    immediatelyRender: false,
    editable,
    // Cast to the @tiptap/core extension identity that useEditor expects. A
    // duplicated @tiptap/core in node_modules gives StarterKit's extensions a
    // structurally-identical-but-nominally-different type; this aligns them
    // without weakening the rest of the config.
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: false }),
      Placeholder.configure({ placeholder: placeholder ?? "" }),
      Markdown,
    ] as unknown as AnyExtension[],
    content: value,
    editorProps: {
      attributes: {
        class: "twin-editor-prosemirror",
        spellcheck: "true",
      },
    },
    onUpdate: ({ editor: ed }) => {
      onChange?.(getMarkdown(ed));
    },
  });

  // Keep editable in sync if the prop changes.
  useEffect(() => {
    if (!editor) return;
    if (editor.isEditable !== editable) editor.setEditable(editable);
  }, [editor, editable]);

  // Reset content when the external value changes (e.g. switching files),
  // but never clobber what the user is actively typing.
  useEffect(() => {
    if (!editor) return;
    if (editor.isFocused) return;
    const current = getMarkdown(editor);
    if (current !== value) {
      editor.commands.setContent(value, { emitUpdate: false });
    }
  }, [editor, value]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        border: "1px solid var(--hairline)",
        borderRadius: 8,
        background: "var(--surface)",
        overflow: "hidden",
      }}
    >
      {editor && editable ? <Toolbar editor={editor} /> : null}
      <EditorContent editor={editor} />
      <style jsx global>{`
        .twin-editor-prosemirror {
          min-height: 240px;
          padding: var(--sp-16, 16px);
          color: var(--text);
          font-family: inherit;
          font-size: var(--fs-ui, 14px);
          line-height: 1.6;
          outline: none;
        }
        .twin-editor-prosemirror :first-child {
          margin-top: 0;
        }
        .twin-editor-prosemirror h1 {
          font-size: 1.6em;
          font-weight: 650;
          margin: 0.8em 0 0.4em;
        }
        .twin-editor-prosemirror h2 {
          font-size: 1.35em;
          font-weight: 650;
          margin: 0.8em 0 0.4em;
        }
        .twin-editor-prosemirror h3 {
          font-size: 1.15em;
          font-weight: 600;
          margin: 0.8em 0 0.4em;
        }
        .twin-editor-prosemirror p {
          margin: 0.5em 0;
        }
        .twin-editor-prosemirror ul,
        .twin-editor-prosemirror ol {
          padding-left: 1.4em;
          margin: 0.5em 0;
        }
        .twin-editor-prosemirror li > p {
          margin: 0.2em 0;
        }
        .twin-editor-prosemirror a {
          color: var(--accent);
          text-decoration: underline;
          cursor: pointer;
        }
        .twin-editor-prosemirror blockquote {
          border-left: 3px solid var(--hairline);
          margin: 0.6em 0;
          padding-left: 0.9em;
          color: var(--text-muted, var(--text));
        }
        .twin-editor-prosemirror code {
          background: var(--bg-elevated);
          border: 1px solid var(--hairline);
          border-radius: 4px;
          padding: 0.1em 0.3em;
          font-size: 0.9em;
        }
        .twin-editor-prosemirror pre {
          background: var(--bg-elevated);
          border: 1px solid var(--hairline);
          border-radius: 6px;
          padding: var(--sp-12, 12px);
          overflow-x: auto;
          margin: 0.6em 0;
        }
        .twin-editor-prosemirror pre code {
          background: none;
          border: none;
          padding: 0;
        }
        .twin-editor-prosemirror p.is-editor-empty:first-child::before {
          content: attr(data-placeholder);
          color: var(--text-muted, rgba(0, 0, 0, 0.4));
          float: left;
          height: 0;
          pointer-events: none;
        }
      `}</style>
    </div>
  );
}

export default TwinEditor;
