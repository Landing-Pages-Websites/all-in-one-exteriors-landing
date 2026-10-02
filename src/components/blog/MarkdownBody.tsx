import type { ReactElement, ReactNode } from "react";
import BlogImage from "@/components/blog/BlogImage";
import {
  parseBlocks,
  type Block,
  type InlineNode,
  type ListItem,
} from "@/lib/markdown";

interface MarkdownBodyProps {
  source: string;
}

function renderInline(nodes: InlineNode[]): ReactNode[] {
  return nodes.map((node, index) => {
    switch (node.kind) {
      case "strong":
        return <strong key={index}>{node.value}</strong>;
      case "em":
        return <em key={index}>{node.value}</em>;
      case "code":
        return (
          <code
            key={index}
            className="rounded bg-neutral-100 px-1 py-0.5 text-[0.9em] dark:bg-neutral-800"
          >
            {node.value}
          </code>
        );
      case "link":
        return (
          <a key={index} href={node.href} className="underline">
            {node.text}
          </a>
        );
      case "image":
        return (
          <BlogImage
            key={index}
            src={node.src}
            alt={node.alt}
            variant="body"
          />
        );
      default:
        return node.value;
    }
  });
}

function renderItems(items: ListItem[], ordered: boolean): ReactNode {
  return items.map((item, index) => (
    <li key={index} className={ordered ? "list-decimal" : "list-disc"}>
      {renderInline(item.inline)}
      {/* Each child group renders with its OWN element: a numbered list
          nested under a bullet must stay numbered. */}
      {item.children.map((group, groupIndex) => {
        const Tag = group.ordered ? "ol" : "ul";
        return (
          <Tag key={groupIndex} className="mt-2 list-inside space-y-2 pl-5">
            {renderItems(group.items, group.ordered)}
          </Tag>
        );
      })}
    </li>
  ));
}

function renderBlock(block: Block, key: number): ReactElement {
  switch (block.kind) {
    case "heading": {
      const Tag = block.level === 2 ? "h2" : "h3";
      const className =
        block.level === 2
          ? "mt-10 text-xl font-semibold"
          : "mt-8 text-lg font-semibold";
      return (
        <Tag key={key} className={className}>
          {renderInline(block.inline)}
        </Tag>
      );
    }
    case "list": {
      const Tag = block.ordered ? "ol" : "ul";
      return (
        <Tag key={key} className="mt-4 list-inside space-y-2 pl-1">
          {renderItems(block.items, block.ordered)}
        </Tag>
      );
    }
    case "blockquote":
      return (
        <blockquote
          key={key}
          className="mt-6 border-l-4 border-neutral-300 pl-4 italic text-neutral-600 dark:border-neutral-600 dark:text-neutral-400"
        >
          {block.lines.map((line, index) => (
            <p key={index} className={index === 0 ? "" : "mt-3"}>
              {renderInline(line)}
            </p>
          ))}
        </blockquote>
      );
    case "table":
      return (
        // Wide tables scroll inside their own container so the page body
        // never scrolls sideways on a phone.
        <div key={key} className="mt-6 overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr>
                {block.header.map((cell, index) => (
                  <th
                    key={index}
                    className="border-b border-neutral-300 px-3 py-2 font-semibold dark:border-neutral-700"
                  >
                    {renderInline(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <td
                      key={cellIndex}
                      className="border-b border-neutral-200 px-3 py-2 align-top dark:border-neutral-800"
                    >
                      {renderInline(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "code":
      return (
        <pre
          key={key}
          className="mt-6 overflow-x-auto rounded-lg bg-neutral-100 p-4 text-sm dark:bg-neutral-900"
        >
          <code>{block.text}</code>
        </pre>
      );
    case "image":
      return (
        <div key={key} className="mt-6">
          <BlogImage src={block.src} alt={block.alt} variant="body" />
        </div>
      );
    default:
      return (
        <p
          key={key}
          className="mt-4 leading-relaxed text-neutral-700 first:mt-0 dark:text-neutral-300"
        >
          {renderInline(block.inline)}
        </p>
      );
  }
}

export default function MarkdownBody({
  source,
}: MarkdownBodyProps): ReactElement {
  return <div>{parseBlocks(source).map(renderBlock)}</div>;
}
