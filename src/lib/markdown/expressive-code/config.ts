import { pluginCollapsibleSections } from "@expressive-code/plugin-collapsible-sections"
import { pluginLineNumbers } from "@expressive-code/plugin-line-numbers"
import {
  createRenderer,
  type SatteriExpressiveCodeOptions,
} from "satteri-expressive-code"
import { radixTheme } from "./radix-theme"

const ecOptions: SatteriExpressiveCodeOptions = {
  themes: ["vitesse-light", "vitesse-dark"],
  // Vitesse's colours moved onto the nearest Radix steps (radix-theme.ts).
  customizeTheme: (theme) => radixTheme(theme),
  // Radix's text steps already clear 4.5:1 on the code surface; any
  // further adjustment would move them off their steps.
  minSyntaxHighlightingColorContrast: 0,
  useDarkModeMediaQuery: true,
  themeCssSelector: (theme) => `[data-theme="${theme.type}"]`,
  plugins: [pluginCollapsibleSections(), pluginLineNumbers()],
  defaultProps: {
    wrap: true,
    showLineNumbers: true,
    collapseStyle: "collapsible-auto",
    overridesByLang: {
      "ansi,bat,bash,batch,cmd,console,powershell,ps,ps1,psd1,psm1,sh,shell,shellscript,shellsession,text,zsh":
        {
          showLineNumbers: false,
        },
    },
  },
  styleOverrides: {
    codeFontSize: "var(--step--1)",
    codeFontFamily: "var(--font-mono)",
    codeBackground: "var(--surface)",
    borderColor: "var(--border)",
    borderWidth: "var(--hairline)",
    // A tile, like a callout and the home page cards.
    borderRadius: "var(--radius-lg)",
    uiFontFamily: "var(--font-sans)",
    uiFontSize: "var(--step--1)",
    gutterBorderColor: "var(--border)",
    gutterBorderWidth: "var(--hairline)",
    codeSelectionBackground: "var(--grass-a5)",
    lineNumbers: {
      foreground: "var(--muted-foreground)",
    },
    frames: {
      editorActiveTabForeground: "var(--muted-foreground)",
      inlineButtonForeground: "var(--foreground)",
      inlineButtonBackground: "var(--neutral-12)",
      inlineButtonBorder: "var(--border-strong)",
      editorActiveTabBackground: "transparent",
      editorActiveTabIndicatorBottomColor: "transparent",
      editorActiveTabIndicatorTopColor: "transparent",
      editorTabBorderRadius: "0",
      editorTabBarBackground: "transparent",
      editorTabBarBorderBottomColor: "transparent",
      frameBoxShadowCssValue: "none",
      terminalBackground: "var(--surface)",
      terminalTitlebarBackground: "transparent",
      terminalTitlebarBorderBottomColor: "transparent",
      terminalTitlebarForeground: "var(--muted-foreground)",
    },
    // Marked lines and spans: an alpha fill and a hairline in Radix steps,
    // and no coloured bar down the left edge.
    textMarkers: {
      markBackground: "var(--neutral-a3)",
      markBorderColor: "var(--neutral-a6)",
      insBackground: "var(--grass-a3)",
      insBorderColor: "var(--grass-a6)",
      delBackground: "var(--red-a3)",
      delBorderColor: "var(--red-a6)",
      lineMarkerAccentWidth: "0",
      inlineMarkerBorderWidth: "var(--hairline)",
      inlineMarkerBorderRadius: "var(--radius-sm)",
      lineMarkerLabelColor: "var(--foreground)",
    },
    collapsibleSections: {
      closedFontFamily: "var(--font-sans)",
    },
  },
}

export const ecRenderer = createRenderer(ecOptions)
