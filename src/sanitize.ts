const BLOCKED_TAGS = new Set([
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "form",
  "input",
  "button",
  "select",
  "textarea",
  "link",
  "meta",
  "base",
  "template",
  "noscript",
  "canvas",
]);

/**
 * Minimal sanitizer for readability output. Readability already strips most
 * risky markup; this pass removes remaining script/style elements, event
 * handler attributes, inline styles and javascript: URLs before rendering.
 */
export function sanitizeHtml(html: string): string {
  const document = new DOMParser().parseFromString(html, "text/html");
  const root = document.body;

  for (const element of Array.from(root.querySelectorAll("*"))) {
    const tag = element.tagName.toLowerCase();
    if (BLOCKED_TAGS.has(tag)) {
      element.remove();
      continue;
    }

    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim().toLowerCase();
      const isUnsafeUrl =
        (name === "href" || name === "src") &&
        (value.startsWith("javascript:") || value.startsWith("data:text/html"));

      if (name.startsWith("on") || name === "style" || isUnsafeUrl) {
        element.removeAttribute(attribute.name);
      }
    }
  }

  return root.innerHTML;
}
