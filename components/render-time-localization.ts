import { Children, Fragment, cloneElement, createElement, isValidElement, type ReactElement, type ReactNode } from "react";

const BUSINESS_VALUE_MARKER = Symbol("kai-cloud-business-value");

export function BusinessValue({ children }: { children: ReactNode }) {
  return createElement(Fragment, null, children);
}

Object.defineProperty(BusinessValue, BUSINESS_VALUE_MARKER, { value: true });

const FIXED_COPY_PROPS = new Set(["aria-label", "description", "label", "action", "placeholder", "title"]);

function isBusinessValue(element: ReactElement) {
  return typeof element.type === "function" && BUSINESS_VALUE_MARKER in element.type;
}

export function localizeNode(node: ReactNode, localizeText: (value: string) => string): ReactNode {
  if (typeof node === "string") return localizeText(node);
  if (!isValidElement(node)) return node;
  if (isBusinessValue(node)) return node;

  const element = node as ReactElement<Record<string, unknown>>;
  const nextProps: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(element.props)) {
    if (key === "children") {
      nextProps.children = Children.map(value as ReactNode, (child) => localizeNode(child, localizeText));
    } else if (FIXED_COPY_PROPS.has(key)) {
      nextProps[key] = typeof value === "string"
        ? localizeText(value)
        : localizeNode(value as ReactNode, localizeText);
    } else {
      nextProps[key] = value;
    }
  }
  return cloneElement(element, nextProps);
}
