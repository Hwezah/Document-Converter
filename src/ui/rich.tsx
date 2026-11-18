import { Extension, type Editor } from "@tiptap/core";
import { useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import TextAlign from "@tiptap/extension-text-align";
import Highlight from "@tiptap/extension-highlight";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { TableKit } from "@tiptap/extension-table";
import { TextStyleKit } from "@tiptap/extension-text-style";
import Placeholder from "@tiptap/extension-placeholder";
import CharacterCount from "@tiptap/extension-character-count";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, Code, Eraser, Heading1, Highlighter, Image as ImageIcon, Italic, Link2, List,
  ListChecks, ListOrdered, Minus, Palette, Quote, Redo2, Strikethrough, Table as TableIcon, Underline, Undo2, Trash2, Rows3, Columns3,
} from "lucide-react";
import { blobToDataUrl } from "../lib/store";
import { usePrompt } from "./kit";

/* ---------- Find & replace: a ProseMirror plugin that marks every hit ---------- */

export const findKey = new PluginKey<FindState>("find");
interface FindState {
  term: string;
  cur: number;
  caseSensitive: boolean;
  hits: { from: number; to: number }[];
  deco: DecorationSet;
}

function search(doc: PMNode, term: string, cs: boolean) {
  const hits: { from: number; to: number }[] = [];
  if (!term) return hits;
  const needle = cs ? term : term.toLowerCase();
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    // A block's text with each character's document position, so hits can span bold/italic runs.
    let text = "";
    const map: number[] = [];
    node.forEach((child, offset) => {
      if (child.isText) {
        for (let i = 0; i < child.text!.length; i++) map.push(pos + 1 + offset + i);
        text += child.text;
      } else {
        map.push(-1);
        text += "￼";
      }
    });
    const hay = cs ? text : text.toLowerCase();
    for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + needle.length)) hits.push({ from: map[i], to: map[i + needle.length - 1] + 1 });
    return false;
  });
  return hits;
}

const Find = Extension.create({
  name: "find",
  addProseMirrorPlugins() {
    return [
      new Plugin<FindState>({
        key: findKey,
        state: {
          init: () => ({ term: "", cur: 0, caseSensitive: false, hits: [], deco: DecorationSet.empty }),
          apply(tr, old) {
            const meta = tr.getMeta(findKey) as Partial<FindState> | undefined;
            if (!meta && !tr.docChanged) return old;
            const term = meta?.term ?? old.term;
            const caseSensitive = meta?.caseSensitive ?? old.caseSensitive;
            const hits = search(tr.doc, term, caseSensitive);
            const cur = hits.length ? (((meta?.cur ?? old.cur) % hits.length) + hits.length) % hits.length : 0;
            const deco = DecorationSet.create(tr.doc, hits.map((h, i) => Decoration.inline(h.from, h.to, { class: i === cur ? "find-hit cur" : "find-hit" })));
            return { term, cur, caseSensitive, hits, deco };
          },
        },
        props: { decorations: (state: EditorState) => findKey.getState(state)?.deco },
      }),
    ];
  },
});

export function setFind(ed: Editor, p: Partial<Pick<FindState, "term" | "cur" | "caseSensitive">>) {
  ed.view.dispatch(ed.state.tr.setMeta(findKey, p));
  const st = findKey.getState(ed.state)!;
  const hit = st.hits[st.cur];
  if (hit && p.cur != null) {
    const dom = ed.view.domAtPos(hit.from).node as HTMLElement;
    (dom.nodeType === 3 ? dom.parentElement : dom)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }
  return st;
}

export function replaceHits(ed: Editor, rep: string, all: boolean) {
  const st = findKey.getState(ed.state)!;
  const hits = all ? st.hits : st.hits.slice(st.cur, st.cur + 1);
  if (!hits.length) return 0;
  const tr = ed.state.tr;
  for (const h of [...hits].reverse()) tr.insertText(rep, h.from, h.to);
  ed.view.dispatch(tr);
  return hits.length;
}

/* ---------- The editor ---------- */

async function insertImages(ed: Editor, files: File[], pos?: number) {
  for (const f of files.filter((f) => f.type.startsWith("image/"))) {
    const src = await blobToDataUrl(f);
    if (pos != null) ed.chain().insertContentAt(pos, { type: "image", attrs: { src, alt: f.name } }).run();
    else ed.chain().focus().setImage({ src, alt: f.name }).run();
  }
}

export function useRichEditor(opts: { html: string; placeholder: string; onChange: (html: string, text: string) => void; autofocus?: boolean }) {
  const onChange = useRef(opts.onChange);
  onChange.current = opts.onChange;
  return useEditor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false, autolink: true, HTMLAttributes: { rel: "noopener noreferrer nofollow", target: "_blank" } } }),
      Image.configure({ inline: false, allowBase64: true }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Highlight.configure({ multicolor: true }),
      TaskList,
      TaskItem.configure({ nested: true }),
      TableKit.configure({ table: { resizable: true } }),
      TextStyleKit,
      Placeholder.configure({ placeholder: opts.placeholder }),
      CharacterCount,
      Find,
    ],
    content: opts.html,
    autofocus: opts.autofocus ? "end" : false,
    editorProps: {
      attributes: { spellcheck: "true" },
      handlePaste: (view, e) => {
        const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
        if (!files.length) return false;
        const ed = (view.dom as unknown as { editor: Editor }).editor;
        insertImages(ed, files);
        return true;
      },
      handleDrop: (view, e) => {
        const files = [...((e as DragEvent).dataTransfer?.files ?? [])].filter((f) => f.type.startsWith("image/"));
        if (!files.length) return false;
        e.preventDefault();
        e.stopPropagation();
        const pos = view.posAtCoords({ left: (e as DragEvent).clientX, top: (e as DragEvent).clientY })?.pos;
        insertImages((view.dom as unknown as { editor: Editor }).editor, files, pos);
        return true;
      },
    },
    onUpdate: ({ editor }) => onChange.current(editor.getHTML(), editor.getText()),
  });
}

/* ---------- Toolbar ---------- */

function Tb({ on, title, run, children, disabled }: { on?: boolean; title: string; run: () => void; children: ReactNode; disabled?: boolean }) {
  return (
    <button type="button" className={`tb ${on ? "on" : ""}`} title={title} aria-label={title} aria-pressed={on} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={run}>
      {children}
    </button>
  );
}

const FONTS = [
  { label: "Sans", value: "" },
  { label: "Serif", value: "Georgia, 'Times New Roman', serif" },
  { label: "Mono", value: "ui-monospace, Consolas, monospace" },
  { label: "Rounded", value: "'Trebuchet MS', 'Segoe UI', sans-serif" },
];
const SIZES = ["", "12px", "14px", "18px", "22px", "28px", "36px"];

export function Toolbar({ editor, compact }: { editor: Editor; compact?: boolean }) {
  const prompt = usePrompt();
  const imgInput = useRef<HTMLInputElement>(null);
  const [, force] = useState(0);
  // Re-render on selection so the active states follow the caret.
  useEffect(() => {
    const f = () => force((n) => n + 1);
    editor.on("transaction", f);
    return () => {
      editor.off("transaction", f);
    };
  }, [editor]);
  const c = () => editor.chain().focus();
  const block = editor.isActive("heading", { level: 1 }) ? "h1" : editor.isActive("heading", { level: 2 }) ? "h2" : editor.isActive("heading", { level: 3 }) ? "h3" : editor.isActive("codeBlock") ? "code" : editor.isActive("blockquote") ? "quote" : "p";
  const inTable = editor.isActive("table");
  const color = (editor.getAttributes("textStyle").color as string) || "";
  const font = (editor.getAttributes("textStyle").fontFamily as string) || "";
  const size = (editor.getAttributes("textStyle").fontSize as string) || "";

  const setLink = async () => {
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = await prompt({ title: prev ? "Edit link" : "Add a link", value: prev ?? "https://", placeholder: "https://…", ok: "Apply" });
    if (url == null) return;
    if (!url.trim() || url === "https://") c().extendMarkRange("link").unsetLink().run();
    else c().extendMarkRange("link").setLink({ href: /^[a-z]+:/i.test(url) ? url : "https://" + url }).run();
  };

  return (
    <div className="toolbar glass" role="toolbar" aria-label="Formatting">
      <Tb title="Undo (Ctrl+Z)" run={() => c().undo().run()} disabled={!editor.can().undo()}><Undo2 size={17} /></Tb>
      <Tb title="Redo (Ctrl+Y)" run={() => c().redo().run()} disabled={!editor.can().redo()}><Redo2 size={17} /></Tb>
      <span className="tb-sep" />
      {!compact && (
        <>
          <select
            className="tb-select"
            aria-label="Text style"
            value={block}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "p") c().setParagraph().run();
              else if (v === "quote") c().setParagraph().toggleBlockquote().run();
              else if (v === "code") c().toggleCodeBlock().run();
              else c().setHeading({ level: Number(v[1]) as 1 | 2 | 3 }).run();
            }}
          >
            <option value="p">Normal text</option>
            <option value="h1">Title</option>
            <option value="h2">Heading</option>
            <option value="h3">Subheading</option>
            <option value="quote">Quote</option>
            <option value="code">Code</option>
          </select>
          <select className="tb-select" aria-label="Font" value={font} onChange={(e) => (e.target.value ? c().setFontFamily(e.target.value).run() : c().unsetFontFamily().run())}>
            {FONTS.map((f) => <option key={f.label} value={f.value}>{f.label}</option>)}
          </select>
          <select className="tb-select" aria-label="Size" value={size} onChange={(e) => (e.target.value ? c().setFontSize(e.target.value).run() : c().unsetFontSize().run())}>
            {SIZES.map((s) => <option key={s} value={s}>{s ? parseInt(s) : "Size"}</option>)}
          </select>
          <span className="tb-sep" />
        </>
      )}
      {compact && <Tb title="Heading" on={editor.isActive("heading")} run={() => c().toggleHeading({ level: 2 }).run()}><Heading1 size={17} /></Tb>}
      <Tb title="Bold (Ctrl+B)" on={editor.isActive("bold")} run={() => c().toggleBold().run()}><Bold size={17} /></Tb>
      <Tb title="Italic (Ctrl+I)" on={editor.isActive("italic")} run={() => c().toggleItalic().run()}><Italic size={17} /></Tb>
      <Tb title="Underline (Ctrl+U)" on={editor.isActive("underline")} run={() => c().toggleUnderline().run()}><Underline size={17} /></Tb>
      <Tb title="Strikethrough" on={editor.isActive("strike")} run={() => c().toggleStrike().run()}><Strikethrough size={17} /></Tb>
      {!compact && <Tb title="Inline code" on={editor.isActive("code")} run={() => c().toggleCode().run()}><Code size={17} /></Tb>}
      <label className="tb tb-color" title="Text colour">
        <Palette size={17} />
        <span className="bar" style={{ background: color || "var(--text)" }} />
        <input type="color" aria-label="Text colour" value={/^#/.test(color) ? color : "#b81d24"} onChange={(e) => c().setColor(e.target.value).run()} />
      </label>
      <Tb title="Highlight" on={editor.isActive("highlight")} run={() => c().toggleHighlight({ color: "#ffe066" }).run()}><Highlighter size={17} /></Tb>
      <span className="tb-sep" />
      {!compact && (
        <>
          <Tb title="Align left" on={editor.isActive({ textAlign: "left" })} run={() => c().setTextAlign("left").run()}><AlignLeft size={17} /></Tb>
          <Tb title="Centre" on={editor.isActive({ textAlign: "center" })} run={() => c().setTextAlign("center").run()}><AlignCenter size={17} /></Tb>
          <Tb title="Align right" on={editor.isActive({ textAlign: "right" })} run={() => c().setTextAlign("right").run()}><AlignRight size={17} /></Tb>
          <Tb title="Justify" on={editor.isActive({ textAlign: "justify" })} run={() => c().setTextAlign("justify").run()}><AlignJustify size={17} /></Tb>
          <span className="tb-sep" />
        </>
      )}
      <Tb title="Bulleted list" on={editor.isActive("bulletList")} run={() => c().toggleBulletList().run()}><List size={17} /></Tb>
      <Tb title="Numbered list" on={editor.isActive("orderedList")} run={() => c().toggleOrderedList().run()}><ListOrdered size={17} /></Tb>
      <Tb title="Checklist" on={editor.isActive("taskList")} run={() => c().toggleTaskList().run()}><ListChecks size={17} /></Tb>
      {compact && <Tb title="Quote" on={editor.isActive("blockquote")} run={() => c().toggleBlockquote().run()}><Quote size={17} /></Tb>}
      <span className="tb-sep" />
      <Tb title="Link (Ctrl+K)" on={editor.isActive("link")} run={setLink}><Link2 size={17} /></Tb>
      <Tb title="Picture" run={() => imgInput.current?.click()}><ImageIcon size={17} /></Tb>
      {!compact && (
        <>
          <Tb title="Table" on={inTable} run={() => c().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}><TableIcon size={17} /></Tb>
          <Tb title="Divider" run={() => c().setHorizontalRule().run()}><Minus size={17} /></Tb>
          <Tb title="Clear formatting" run={() => c().unsetAllMarks().clearNodes().run()}><Eraser size={17} /></Tb>
        </>
      )}
      {inTable && !compact && (
        <>
          <span className="tb-sep" />
          <Tb title="Add row below" run={() => c().addRowAfter().run()}><Rows3 size={17} /></Tb>
          <Tb title="Add column right" run={() => c().addColumnAfter().run()}><Columns3 size={17} /></Tb>
          <Tb title="Delete row" run={() => c().deleteRow().run()}><span style={{ fontSize: 11, fontWeight: 800 }}>−Row</span></Tb>
          <Tb title="Delete column" run={() => c().deleteColumn().run()}><span style={{ fontSize: 11, fontWeight: 800 }}>−Col</span></Tb>
          <Tb title="Header row on/off" run={() => c().toggleHeaderRow().run()}><span style={{ fontSize: 11, fontWeight: 800 }}>Hdr</span></Tb>
          <Tb title="Delete table" run={() => c().deleteTable().run()}><Trash2 size={17} /></Tb>
        </>
      )}
      <input
        ref={imgInput}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          const f = [...(e.target.files ?? [])];
          e.target.value = "";
          insertImages(editor, f);
        }}
      />
    </div>
  );
}

/* ---------- Templates for a blank document ---------- */

const today = () => new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
export const TEMPLATES: { name: string; title: string; html: () => string }[] = [
  {
    name: "Meeting notes",
    title: "Meeting notes",
    html: () => `<h1>Meeting notes</h1><p><strong>Date:</strong> ${today()}<br><strong>Attendees:</strong> </p><h2>Agenda</h2><ol><li><p></p></li></ol><h2>Notes</h2><p></p><h2>Action items</h2><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p></p></li></ul>`,
  },
  {
    name: "Letter",
    title: "Letter",
    html: () => `<p style="text-align: right">Your name<br>Street address<br>City, postcode</p><p style="text-align: right">${today()}</p><p>Recipient name<br>Company<br>Address</p><p>Dear …,</p><p></p><p>Yours sincerely,</p><p><br>Your name</p>`,
  },
  {
    name: "Report",
    title: "Report",
    html: () => `<h1>Report title</h1><p><em>Prepared ${today()}</em></p><h2>Summary</h2><p></p><h2>Background</h2><p></p><h2>Findings</h2><table><tbody><tr><th><p>Item</p></th><th><p>Result</p></th><th><p>Notes</p></th></tr><tr><td><p></p></td><td><p></p></td><td><p></p></td></tr></tbody></table><h2>Recommendations</h2><ul><li><p></p></li></ul>`,
  },
  {
    name: "CV",
    title: "Curriculum vitae",
    html: () => `<h1 style="text-align: center">Your Name</h1><p style="text-align: center">email@example.com · phone · city · website</p><hr><h2>Profile</h2><p></p><h2>Experience</h2><h3>Role — Company</h3><p><em>Start – End</em></p><ul><li><p></p></li></ul><h2>Education</h2><p></p><h2>Skills</h2><p></p>`,
  },
  {
    name: "To-do list",
    title: "To do",
    html: () => `<h1>To do</h1><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p></p></li></ul>`,
  },
];
