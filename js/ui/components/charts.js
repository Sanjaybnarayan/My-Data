/**
 * Charts.
 *
 * Hand-drawn SVG. A charting library would be the largest thing in the bundle
 * by a wide margin, for four chart types that each fit in forty lines — and it
 * would arrive over the network, which an offline-first application cannot
 * rely on.
 *
 * Every chart is accessible: the figure has a text alternative that states
 * what it shows and the numbers behind it, so the data is not lost to anyone
 * who cannot see the picture.
 */

import { h } from '../dom.js';
import { format, formatCompact } from '../../core/money.js';

const SERIES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)',
  'var(--series-5)', 'var(--series-6)', 'var(--series-7)', 'var(--series-8)'];

export const seriesColour = (i) => SERIES[i % SERIES.length];

/** Round a maximum up to something a human would put on an axis. */
export function niceMax(value) {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalised = value / magnitude;
  const step = normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10;
  return step * magnitude;
}

function figure(children, { label, table }) {
  return h('figure', { style: { margin: 0 } }, [
    ...(Array.isArray(children) ? children : [children]),
    // The picture is decorative; this is where the information actually is
    // for a screen reader.
    h('figcaption', { class: 'sr-only' }, [label, table].filter(Boolean).join('. ')),
  ]);
}

/**
 * @param {Array<{label: string, value: number}>} data
 * @param {{height?: number, currency?: string, tone?: (d) => string, label: string}} options
 */
export function barChart(data, { height = 200, currency = 'INR', tone, label = 'Chart' } = {}) {
  if (!data.length) return h('div', { class: 'empty small' }, 'No data yet');

  const width = 100;
  const max = niceMax(Math.max(...data.map((d) => Math.abs(d.value)), 1));
  const gap = 2;
  const barWidth = (width - gap * (data.length - 1)) / data.length;

  const svg = h('svg', {
    class: 'chart',
    viewBox: `0 0 ${width} ${height}`,
    preserveAspectRatio: 'none',
    style: { height: `${height}px` },
    'aria-hidden': 'true',
  }, [
    // Four gridlines: enough to read a value off, few enough not to compete
    // with the bars.
    ...[0.25, 0.5, 0.75, 1].map((f) => h('line', {
      class: 'chart-grid',
      x1: 0, x2: width,
      y1: height - height * f, y2: height - height * f,
      vectorEffect: 'non-scaling-stroke',
    })),
    ...data.map((d, i) => {
      const barHeight = Math.max(1, (Math.abs(d.value) / max) * (height - 4));
      return h('rect', {
        class: 'chart-bar',
        x: i * (barWidth + gap),
        y: height - barHeight,
        width: barWidth,
        height: barHeight,
        rx: 1.5,
        fill: tone ? tone(d) : seriesColour(0),
      });
    }),
  ]);

  const axis = h('div', {
    class: 'row small faint',
    style: { justifyContent: 'space-between', marginTop: 'var(--space-2)' },
  }, data.map((d) => h('span', {
    style: { flex: '1', textAlign: 'center', minWidth: 0 },
    class: 'truncate',
  }, d.label)));

  return figure([svg, axis], {
    label,
    table: data.map((d) => `${d.label}: ${format(d.value, currency)}`).join('; '),
  });
}

/** A line with a filled area beneath, for a running balance or a trend. */
export function lineChart(data, { height = 200, currency = 'INR', label = 'Trend' } = {}) {
  if (data.length < 2) return h('div', { class: 'empty small' }, 'Not enough data yet');

  const width = 100;
  const values = data.map((d) => d.value);
  const min = Math.min(...values, 0);
  const max = niceMax(Math.max(...values, 1));
  const span = max - min || 1;

  const x = (i) => (i / (data.length - 1)) * width;
  const y = (v) => height - ((v - min) / span) * (height - 6) - 3;

  const points = data.map((d, i) => `${x(i).toFixed(2)},${y(d.value).toFixed(2)}`);
  const line = `M${points.join(' L')}`;
  const area = `${line} L${width},${height} L0,${height} Z`;

  return figure([
    h('svg', {
      class: 'chart',
      viewBox: `0 0 ${width} ${height}`,
      preserveAspectRatio: 'none',
      style: { height: `${height}px` },
      'aria-hidden': 'true',
    }, [
      ...[0.5, 1].map((f) => h('line', {
        class: 'chart-grid',
        x1: 0, x2: width, y1: height - height * f, y2: height - height * f,
        vectorEffect: 'non-scaling-stroke',
      })),
      h('path', { class: 'chart-area', d: area, fill: seriesColour(0) }),
      h('path', {
        class: 'chart-line', d: line, stroke: seriesColour(0),
        vectorEffect: 'non-scaling-stroke',
      }),
    ]),
    h('div', { class: 'row row--between small faint', style: { marginTop: 'var(--space-2)' } }, [
      h('span', {}, data[0].label),
      h('span', {}, data.at(-1).label),
    ]),
  ], {
    label,
    table: data.map((d) => `${d.label}: ${format(d.value, currency)}`).join('; '),
  });
}

/**
 * A donut, for composition — asset allocation, spending by category.
 * Segments below 1.5% are folded into "other" rather than drawn as slivers
 * nobody can see or click.
 */
export function donutChart(data, { size = 180, currency = 'INR', label = 'Breakdown' } = {}) {
  const total = data.reduce((t, d) => t + Math.abs(d.value), 0);
  if (!total) return h('div', { class: 'empty small' }, 'No data yet');

  const threshold = total * 0.015;
  const big = data.filter((d) => Math.abs(d.value) >= threshold);
  const small = data.filter((d) => Math.abs(d.value) < threshold);
  const slices = small.length
    ? [...big, { label: 'Other', value: small.reduce((t, d) => t + Math.abs(d.value), 0) }]
    : big;

  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  const rings = slices.map((d, i) => {
    const fraction = Math.abs(d.value) / total;
    const ring = h('circle', {
      cx: 50, cy: 50, r: radius,
      fill: 'none',
      stroke: seriesColour(i),
      'stroke-width': 14,
      'stroke-dasharray': `${(fraction * circumference).toFixed(3)} ${circumference.toFixed(3)}`,
      'stroke-dashoffset': (-offset * circumference).toFixed(3),
      transform: 'rotate(-90 50 50)',
    });
    offset += fraction;
    return ring;
  });

  return figure([
    h('div', { class: 'row', style: { gap: 'var(--space-5)', alignItems: 'center' } }, [
      h('svg', {
        viewBox: '0 0 100 100',
        style: { width: `${size}px`, height: `${size}px`, flex: 'none' },
        'aria-hidden': 'true',
      }, [
        h('circle', { cx: 50, cy: 50, r: radius, fill: 'none', stroke: 'var(--surface-sunken)', 'stroke-width': 14 }),
        ...rings,
        h('text', {
          x: 50, y: 49, 'text-anchor': 'middle',
          style: { fontSize: '11px', fontWeight: '600', fill: 'var(--text)' },
        }, formatCompact(total, currency)),
        h('text', {
          x: 50, y: 60, 'text-anchor': 'middle',
          style: { fontSize: '6px', fill: 'var(--text-faint)' },
        }, 'total'),
      ]),
      h('div', { class: 'stack stack--tight spacer' }, slices.map((d, i) => h('div', {
        class: 'row row--between small',
      }, [
        h('span', { class: 'legend-item' }, [
          h('span', { class: 'legend-swatch', style: { background: seriesColour(i) } }),
          d.label,
        ]),
        h('span', { class: 'numeric muted' },
          `${Math.round((Math.abs(d.value) / total) * 100)}%`),
      ]))),
    ]),
  ], {
    label,
    table: slices.map((d) => `${d.label}: ${format(d.value, currency)}`).join('; '),
  });
}

/** A trend small enough to sit inside a table cell or a metric card. */
export function sparkline(values, { positive = true } = {}) {
  if (values.length < 2) return h('div', { class: 'sparkline' });

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * 100;
    const y = 30 - ((v - min) / span) * 28 - 1;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });

  return h('svg', {
    class: 'sparkline',
    viewBox: '0 0 100 30',
    preserveAspectRatio: 'none',
    'aria-hidden': 'true',
  }, h('path', {
    class: 'chart-line',
    d: `M${points.join(' L')}`,
    stroke: positive ? 'var(--positive)' : 'var(--danger)',
    vectorEffect: 'non-scaling-stroke',
  }));
}

export function legend(items) {
  return h('div', { class: 'legend' }, items.map((item, i) => h('span', { class: 'legend-item' }, [
    h('span', { class: 'legend-swatch', style: { background: item.colour ?? seriesColour(i) } }),
    item.label,
  ])));
}
