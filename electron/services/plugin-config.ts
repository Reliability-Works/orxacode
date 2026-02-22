import { applyEdits, modify, parse as parseJsonc, printParseErrorCode } from "jsonc-parser";

export const ORXA_PLUGIN_PACKAGE = "@reliabilityworks/opencode-orxa";
export const ORXA_PLUGIN_VERSION = "1.0.43";
export const ORXA_PLUGIN_SPECIFIER = `${ORXA_PLUGIN_PACKAGE}@${ORXA_PLUGIN_VERSION}`;

export function canonicalPluginName(specifier: string) {
  if (specifier.startsWith("file://")) {
    const url = new URL(specifier);
    return url.pathname.split("/").pop()?.replace(/\.[^./]+$/, "") ?? specifier;
  }
  const lastAt = specifier.lastIndexOf("@");
  if (lastAt > 0) {
    return specifier.slice(0, lastAt);
  }
  return specifier;
}

export function updateOrxaPluginInConfigDocument(sourceInput: string, targetMode: "orxa" | "standard") {
  const source = sourceInput.trim().length > 0 ? sourceInput : "{}\n";
  const parseErrors: Parameters<typeof parseJsonc>[1] = [];
  const parsed = parseJsonc(source, parseErrors, { allowTrailingComma: true });
  if (parseErrors.length > 0) {
    const first = parseErrors[0]!;
    throw new Error(`Failed to parse OpenCode config: ${printParseErrorCode(first.error)} at offset ${first.offset}`);
  }

  const doc = parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
  const configuredPlugins = Array.isArray(doc.plugin)
    ? doc.plugin.filter((item): item is string => typeof item === "string")
    : [];
  const cleanedPlugins = configuredPlugins.filter((item) => {
    if (item.includes("opencode-orxa")) {
      return false;
    }
    return canonicalPluginName(item) !== ORXA_PLUGIN_PACKAGE;
  });
  const nextPlugins = targetMode === "orxa" ? [...cleanedPlugins, ORXA_PLUGIN_SPECIFIER] : cleanedPlugins;
  const changed =
    nextPlugins.length !== configuredPlugins.length ||
    nextPlugins.some((item, index) => item !== configuredPlugins[index]);
  if (!changed) {
    return { changed: false, output: source.endsWith("\n") ? source : `${source}\n` };
  }

  const edits = modify(source, ["plugin"], nextPlugins, {
    formattingOptions: {
      insertSpaces: true,
      tabSize: 2,
    },
  });
  const output = applyEdits(source, edits);
  return {
    changed: true,
    output: output.endsWith("\n") ? output : `${output}\n`,
  };
}
