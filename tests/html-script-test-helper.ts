/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
 */

import { parse } from "parse5";

type HtmlNode = {
  attrs?: Array<{ name: string; value: string }>;
  childNodes?: HtmlNode[];
  sourceCodeLocation?: {
    endTag?: { startOffset: number };
    startTag?: { endOffset: number };
  };
  tagName?: string;
};

export type InspectedHtmlScript = {
  attributes: ReadonlyMap<string, string>;
  inlineContent: string;
};

export function inspectHtmlScripts(html: string): InspectedHtmlScript[] {
  const scripts: InspectedHtmlScript[] = [];
  const pending = [parse(html, { sourceCodeLocationInfo: true }) as HtmlNode];

  while (pending.length > 0) {
    const node = pending.pop();
    if (!node) continue;

    if (node.tagName === "script") {
      const startTag = node.sourceCodeLocation?.startTag;
      const endTag = node.sourceCodeLocation?.endTag;
      if (!startTag || !endTag) {
        throw new Error("Test HTML contains an unterminated script element.");
      }
      scripts.push({
        attributes: new Map(
          (node.attrs ?? []).map(({ name, value }) => [name, value])
        ),
        inlineContent: html.slice(startTag.endOffset, endTag.startOffset),
      });
    }

    pending.push(...(node.childNodes ?? []));
  }

  return scripts.reverse();
}
