'use client';

import { Children, isValidElement } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';

import { CitationChip } from '@/components/citations/CitationChip';
import { parseCitationHref } from '@/components/citations/utils';
import { D3Visualization } from '@/components/D3Visualization';
import type { VisualizationSpec } from '@/lib/api';

interface MarkdownReportProps {
  content: string;
  className?: string;
}

function parseD3VisualizationSpec(value: string): VisualizationSpec | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed as VisualizationSpec;
  } catch {
    return null;
  }
}

function extractText(value: React.ReactNode): string {
  return Children.toArray(value)
    .map((child) => {
      if (typeof child === 'string' || typeof child === 'number') {
        return String(child);
      }
      if (isValidElement<{ children?: React.ReactNode }>(child)) {
        return extractText(child.props.children);
      }
      return '';
    })
    .join('')
    .trim();
}

function isInlineReportCitationLabel(text: string): boolean {
  return /^\s*(?:\(\d+\)|#\d+|\[\d+\])\s*/.test(text);
}

export function MarkdownReport({ content, className }: MarkdownReportProps) {
  const components: Components = {
    h1(props) {
      const { node: _node, ...rest } = props as any;
      return <h1 className='report-h1' {...rest} />;
    },
    h2(props) {
      const { node: _node, ...rest } = props as any;
      return <h2 className='report-h2' {...rest} />;
    },
    h3(props) {
      const { node: _node, ...rest } = props as any;
      return <h3 className='report-h3' {...rest} />;
    },
    h4(props) {
      const { node: _node, ...rest } = props as any;
      return <h4 className='report-h4' {...rest} />;
    },
    a(props) {
      const { node: _node, href, children, ...rest } = props as any;
      if (typeof href === 'string' && parseCitationHref(href)) {
        const label = extractText(children);
        return (
          <CitationChip href={href} variant={isInlineReportCitationLabel(label) ? 'report-inline' : 'default'}>
            {children}
          </CitationChip>
        );
      }
      return (
        <a href={href} target='_blank' rel='noreferrer' className='report-link' {...rest}>
          {children}
        </a>
      );
    },
    table(props) {
      const { node: _node, ...rest } = props as any;
      return (
        <div className='my-6 overflow-x-auto rounded-[1.4rem] border border-zinc-200 bg-white/70'>
          <table {...rest} />
        </div>
      );
    },
    code(props) {
      const { className: rawClassName, children, ...rest } = props as {
        className?: string;
        children?: React.ReactNode;
      };
      const className = rawClassName || '';
      const match = /language-(\w+)/.exec(className);
      const codeValue = String(children ?? '').replace(/\n$/, '');
      if (match?.[1] === 'd3chart') {
        const spec = parseD3VisualizationSpec(codeValue);
        if (!spec) {
          return (
            <pre className='my-3 overflow-x-auto rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700'>
              d3chart 解析失败，请检查 JSON 结构。
            </pre>
          );
        }
        return <D3Visualization spec={spec} className='my-3 rounded-xl border border-crimson-100 bg-crimson-50/20 p-3' />;
      }
      return (
        <code className={className} {...rest}>
          {children}
        </code>
      );
    },
    img(props) {
      const { alt, src } = props;
      if (!src) return null;
      return <img src={src} alt={alt ?? ''} loading='lazy' className='my-3 h-auto w-full rounded-xl border border-crimson-100 object-contain' />;
    },
  };

  return (
    <div className={`report-markdown ${className ?? ''}`.trim()}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
