import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";
import type { ComponentProps } from "react";
import { Streamdown } from "streamdown";

// App Markdown rendering policy, independent of the former AI Elements API.
const plugins = { cjk, code, math, mermaid };

export function Markdown(props: ComponentProps<typeof Streamdown>) {
  return (
    <Streamdown
      className="w-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
      plugins={plugins}
      {...props}
    />
  );
}
