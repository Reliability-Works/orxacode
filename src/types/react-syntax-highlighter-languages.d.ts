declare module "react-syntax-highlighter/dist/esm/prism-light" {
  import type { ComponentType } from "react";
  import type { SyntaxHighlighterProps } from "react-syntax-highlighter";
  const SyntaxHighlighter: ComponentType<SyntaxHighlighterProps> & {
    registerLanguage(name: string, func: unknown): void;
    alias(name: string, alias: string | string[]): void;
    alias(aliases: Record<string, string | string[]>): void;
  };
  export default SyntaxHighlighter;
}
declare module "react-syntax-highlighter/dist/esm/languages/prism/tsx" {
  const language: unknown;
  export default language;
}
declare module "react-syntax-highlighter/dist/esm/languages/prism/typescript" {
  const language: unknown;
  export default language;
}
declare module "react-syntax-highlighter/dist/esm/languages/prism/javascript" {
  const language: unknown;
  export default language;
}
declare module "react-syntax-highlighter/dist/esm/languages/prism/bash" {
  const language: unknown;
  export default language;
}
declare module "react-syntax-highlighter/dist/esm/languages/prism/json" {
  const language: unknown;
  export default language;
}
declare module "react-syntax-highlighter/dist/esm/languages/prism/python" {
  const language: unknown;
  export default language;
}
declare module "react-syntax-highlighter/dist/esm/languages/prism/css" {
  const language: unknown;
  export default language;
}
declare module "react-syntax-highlighter/dist/esm/languages/prism/go" {
  const language: unknown;
  export default language;
}
declare module "react-syntax-highlighter/dist/esm/languages/prism/rust" {
  const language: unknown;
  export default language;
}
declare module "react-syntax-highlighter/dist/esm/languages/prism/yaml" {
  const language: unknown;
  export default language;
}
declare module "react-syntax-highlighter/dist/esm/languages/prism/sql" {
  const language: unknown;
  export default language;
}
declare module "react-syntax-highlighter/dist/esm/languages/prism/markdown" {
  const language: unknown;
  export default language;
}
declare module "react-syntax-highlighter/dist/esm/languages/prism/diff" {
  const language: unknown;
  export default language;
}
declare module "react-syntax-highlighter/dist/esm/languages/prism/markup" {
  const language: unknown;
  export default language;
}
declare module "react-syntax-highlighter/dist/esm/languages/prism/xml-doc" {
  const language: unknown;
  export default language;
}
