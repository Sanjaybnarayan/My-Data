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
import { icon } from '../icons.js';
import { format, formatCompact } from '../../core/money.js';
import { t } from '../../core/locale.js';

const SERIES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)',
  'var(--series-5)', 'var(--series-6)', 'var(--series-7)', 'var(--series-8)'];

export const seriesColour = (i) => SERIES[i % SERIES.length];

/**
 * The sentence a chart already tells a screen reader, shown to the eye too.
 *
 * Every chart here takes a `label` that becomes its accessible name, and a
 * card holding two of them — bars and a line, say — reads as two unexplained
 * pictures to anyone looking at it. This puts the same words above the
 * figure, `aria-hidden` so they are not announced twice.
 */
export const chartCaption = (text) =>
  h('p', { class: 'chart-caption small muted', 'aria-hidden': 'true' }, text);

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
 * Which labels an axis has room to print.
 *
 * Twelve months across a 316px card gives each label about 26px, and the axis
 * truncated to fit: `O. N. D. J. F. M. A. M. J. J. A. S.` — three months
 * beginning with J, two with M, and no way to tell which is which. A label
 * that cannot be read is not a label.
 *
 * So they thin rather than truncate. The kept ones are counted back from the
 * end, because the last is the month a household is standing in and is the one
 * that must never be the one dropped. The rest keep their slot as an empty
 * span, so the labels stay under their own bars.
 *
 * Nothing is lost: `figure` builds a text equivalent naming every point and
 * its value, which is what a screen reader is given either way.
 */
export function thinLabels(data, room) {
  // No early return for a series that already fits: `step` is 1 for one, and
  // every slot then keeps its label. A branch no test can tell the presence of
  // is a branch that is not there.
  const step = Math.ceil(data.length / room);
  return data.map((d, i) => ((data.length - 1 - i) % step === 0 ? d.label : ''));
}

/**
 * @param {Array<{label: string, value: number, partial?: boolean}>} data
 * @param {{height?: number, currency?: string, tone?: (d) => string, label?: string,
 *          maxLabels?: number}} [options]
 */
export function barChart(data, {
  height = 200, currency = 'INR', tone, label = 'Chart', maxLabels = 7,
} = {}) {
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

  const shown = thinLabels(data, maxLabels);
  const axis = h('div', {
    class: 'chart-axis-labels row small faint',
    style: { justifyContent: 'space-between', marginTop: 'var(--space-2)' },
  }, data.map((d, i) => h('span', {
    // Its own bar's slot, so it stays under what it names — but allowed to
    // spill sideways rather than be cut. Thinning has already emptied the
    // neighbours it spills into; with nothing thinned there are few enough
    // labels that each has room of its own.
    //
    // The two ends align inward, because they have no neighbour on the outside
    // to spill into: centred, `Sep so far` on the last bar hung off the edge of
    // the card. Every label between them stays centred on its bar.
    style: {
      flex: '1',
      textAlign: i === 0 ? 'left' : i === data.length - 1 ? 'right' : 'center',
      minWidth: 0,
    },
  }, shown[i])));

  /*
   * The unfinished month, said in words under the chart.
   *
   * Not in the axis label, where `Sep so far` needed fifty-nine pixels of a
   * twenty-six pixel slot and was either cut to `Se` or laid over the month
   * before it. Not in the colour either, which the master brief forbids as a
   * sole cue and which would say nothing to a screen reader.
   *
   * Here it is one sentence, visible to everyone, and carried into the text
   * equivalent below — the same qualification `domain/finance.js` has always
   * attached, in the one place on the card that has room for it.
   */
  const unfinished = data.find((d) => d.partial);
  const note = unfinished
    ? h('p', { class: 'small faint chart-note' },
      t('chart.partialMonth', { month: unfinished.label }))
    : null;

  return figure([svg, axis, note].filter(Boolean), {
    label,
    table: [
      data.map((d) => `${d.label}: ${format(d.value, currency)}`).join('; '),
      unfinished ? t('chart.partialMonth', { month: unfinished.label }) : '',
    ].filter(Boolean).join('. '),
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
/**
 * `hrefFor` turns each legend row into a link.
 *
 * A breakdown that names where the money went and cannot be opened is a
 * dead end: the household reads "groceries 39%" and has to go and rebuild
 * that filter by hand somewhere else. Given a `hrefFor`, each row becomes an
 * anchor to the rows behind it.
 *
 * It returns null for a slice that has no single thing behind it — the
 * synthetic *Other* bucket is several categories added together, and a link
 * claiming to show "Other" would show a filter nobody asked for.
 */
export function donutChart(data, {
  size = 180, currency = 'INR', label = 'Breakdown', hrefFor = null,
} = {}) {
  const total = data.reduce((t, d) => t + Math.abs(d.value), 0);
  if (!total) return h('div', { class: 'empty small' }, 'No data yet');

  const threshold = total * 0.015;
  const big = data.filter((d) => Math.abs(d.value) >= threshold);
  const small = data.filter((d) => Math.abs(d.value) < threshold);
  const slices = small.length
    ? [...big, {
      label: 'Other',
      value: small.reduce((t, d) => t + Math.abs(d.value), 0),
      // Marked, not named. This bucket used to be told apart by its label
      // reading exactly `Other` — which held only while callers passed the
      // stored key straight through. The overview now passes words, and the
      // schema has a real category called `other`: titled, it reads `Other`
      // too, and matching on the text would have quietly stopped the one
      // category a household files its odds and ends under from opening.
      synthetic: true,
    }]
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
      h('div', { class: 'stack stack--tight spacer' }, slices.map((d, i) => {
        // The synthetic bucket is `small` added together and is deliberately
        // not linkable: there is no one thing behind it to open.
        const href = hrefFor && !d.synthetic ? hrefFor(d) : null;
        const inside = [
          h('span', { class: 'legend-item' }, [
            h('span', { class: 'legend-swatch', style: { background: seriesColour(i) } }),
            d.label,
          ]),
          h('span', { class: 'legend-value' }, [
            h('span', { class: 'numeric muted' },
              `${Math.round((Math.abs(d.value) / total) * 100)}%`),
            // A phone has no hover, so the surface that appears under the
            // pointer says nothing there. The chevron is what says at rest
            // that the row opens — and it is drawn only where one does.
            href ? icon('chevronRight', { size: 16, class: 'legend-go' }) : null,
          ]),
        ];
        // The folded bucket says so in the markup. A check reading its name
        // instead cannot tell it from the schema's own `other` category, which
        // is titled the same way for this legend.
        const marks = d.synthetic ? { 'data-synthetic': '' } : {};
        return href
          ? h('a', {
            class: 'row row--between small legend-row legend-row--link', href, ...marks,
          }, inside)
          : h('div', { class: 'row row--between small legend-row', ...marks }, inside);
      })),
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
