declare module "turndown-plugin-gfm" {
  import type TurndownService from "turndown";
  export const gfm: TurndownService.Plugin;
}
declare module "html-to-pdfmake" {
  export default function htmlToPdfmake(html: string, opts?: Record<string, unknown>): unknown;
}
declare module "pdfmake/build/pdfmake" {
  const pdfMake: unknown;
  export default pdfMake;
}
declare module "pdfmake/build/vfs_fonts" {
  const vfs: Record<string, string>;
  export default vfs;
}
