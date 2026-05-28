'use client';

import { useEffect, useMemo, useRef } from 'react';
import * as d3 from 'd3';

import type { VisualizationSpec } from '@/lib/api';

interface Props {
  spec: VisualizationSpec;
  className?: string;
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function D3Visualization({ spec, className }: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);

  const rows = useMemo(() => spec.data ?? [], [spec.data]);

  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;

    const width = 640;
    const height = 280;
    const margin = { top: 30, right: 20, bottom: 36, left: 48 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();
    svg.attr('viewBox', `0 0 ${width} ${height}`);

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);
    const xKey = spec.chart.x_key;
    const yKey = spec.chart.y_key;

    const xDomain = rows.map((row) => String(row[xKey] ?? ''));
    const yValues = rows.map((row) => toNumber(row[yKey]));
    const maxY = Math.max(1, ...yValues);

    const xScale = d3.scaleBand<string>().domain(xDomain).range([0, innerWidth]).padding(0.2);
    const yScale = d3.scaleLinear().domain([0, maxY]).nice().range([innerHeight, 0]);

    g.append('g')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(d3.axisBottom(xScale))
      .selectAll('text')
      .attr('font-size', 10);

    g.append('g').call(d3.axisLeft(yScale).ticks(5)).selectAll('text').attr('font-size', 10);

    if (spec.chart.type === 'bar') {
      g.selectAll('rect')
        .data(rows)
        .enter()
        .append('rect')
        .attr('x', (d) => xScale(String(d[xKey] ?? '')) ?? 0)
        .attr('y', (d) => yScale(toNumber(d[yKey])))
        .attr('width', xScale.bandwidth())
        .attr('height', (d) => innerHeight - yScale(toNumber(d[yKey])))
        .attr('fill', '#b91c1c');
    } else {
      const xPointScale = d3
        .scalePoint<string>()
        .domain(xDomain)
        .range([0, innerWidth])
        .padding(0.5);

      const line = d3
        .line<Record<string, unknown>>()
        .x((d) => xPointScale(String(d[xKey] ?? '')) ?? 0)
        .y((d) => yScale(toNumber(d[yKey])))
        .curve(d3.curveMonotoneX);

      if (spec.chart.type === 'scatter') {
        g.selectAll('circle')
          .data(rows)
          .enter()
          .append('circle')
          .attr('cx', (d) => xPointScale(String(d[xKey] ?? '')) ?? 0)
          .attr('cy', (d) => yScale(toNumber(d[yKey])))
          .attr('r', 4)
          .attr('fill', '#b91c1c');
      } else {
        const path = g
          .append('path')
          .datum(rows)
          .attr('fill', 'none')
          .attr('stroke', '#b91c1c')
          .attr('stroke-width', 2)
          .attr('d', line);
        if (spec.chart.type === 'area') {
          const area = d3
            .area<Record<string, unknown>>()
            .x((d) => xPointScale(String(d[xKey] ?? '')) ?? 0)
            .y0(innerHeight)
            .y1((d) => yScale(toNumber(d[yKey])))
            .curve(d3.curveMonotoneX);
          g.append('path').datum(rows).attr('d', area).attr('fill', 'rgba(185, 28, 28, 0.2)');
          path.raise();
        }
      }
    }
  }, [rows, spec.chart.type, spec.chart.x_key, spec.chart.y_key]);

  return (
    <div className={className}>
      <p className='text-sm font-semibold text-crimson-800'>{spec.chart.title}</p>
      <svg ref={svgRef} className='mt-2 w-full rounded-xl border border-crimson-100 bg-white' />
      {spec.insights.length > 0 ? (
        <ul className='mt-2 space-y-1 text-xs text-zinc-600'>
          {spec.insights.map((item, idx) => (
            <li key={`${item}-${idx}`}>- {item}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
